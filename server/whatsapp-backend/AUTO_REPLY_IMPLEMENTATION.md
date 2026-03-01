# Auto-Reply Implementation - End-to-End

## 📋 Rezumat

Auto-reply-ul pentru WhatsApp a fost implementat complet end-to-end cu toate gate-urile de securitate necesare.

## 🔍 Analiza Structurii Existente

### 1. Mesaje Inbound
- **Handler**: `handleMessagesUpsert` (linia 758)
- **Trigger**: Event `messages.upsert` de la Baileys
- **Persistență**: `saveMessageToDatabase` (linia 1571)
- **Schema Database**:
  - Colecție: `threads/{threadId}/messages/{messageId}`
  - Câmpuri: `accountId`, `threadId`, `messageId`, `body`, `type`, `fromMe`, `tsSort`, `createdAt`

### 2. Mesaje Outbound
- **Metodă 1**: `sock.sendMessage(remoteJid, { text: message })` (direct)
- **Metodă 2**: Outbox worker (linia 9268) - procesează mesajele din `outbox` collection
- **Endpoint API**: `POST /api/whatsapp/send-message` (linia 6125)
- **Persistență**: Mesajele outbound sunt salvate în `threads/{threadId}/messages/{messageId}` cu `fromMe: true`

### 3. Integrare AI Existente
- **Provider**: Groq API (gratuit, Llama 3.3 70B)
- **Funcție**: `generateAutoReplyText(groqKey, messages)` (linia 486)
- **Config**: `GROQ_API_KEY` environment variable
- **Model**: `llama-3.3-70b-versatile`
- **Parametri**: `temperature: 0.2`, `max_tokens: 200`

## 🛡️ Gate-uri de Securitate Implementate

### Gate 1: Validare Input
- Verifică că `msg` și `saved` există
- **Log**: `[AutoReply] ⏭️  Gate 1 FAIL: msg={} saved={}`

### Gate 2: Nu răspunde la propriile mesaje sau în grupuri
- Skip dacă `fromMe === true`
- Skip dacă `remoteJid.endsWith('@g.us')` (grupuri)
- Skip dacă `remoteJid === 'status@broadcast'`
- **Log**: `[AutoReply] ⏭️  Gate 2 FAIL: fromMe={} isGroup={} remoteJid={}`

### Gate 3: Doar mesaje de tip notify
- Skip dacă `eventType !== 'notify'`
- **Log**: `[AutoReply] ⏭️  Gate 3 FAIL: eventType={}`

### Gate 4: Doar mesaje fresh
- Skip dacă mesajul nu este în ultimele 2 minute (`AI_FRESH_WINDOW_MS = 2 * 60 * 1000`)
- **Log**: `[AutoReply] ⏭️  Gate 4 FAIL: message not fresh`

### Gate 5: Idempotency - Dedupe per messageId
- Skip dacă mesajul a fost deja procesat (dedupe key: `messageId`)
- TTL: 10 minute (`AI_REPLY_DEDUPE_TTL_MS`)
- **Log**: `[AutoReply] ⏭️  Gate 5 FAIL: dedupe hit`

### Gate 6: Doar mesaje text
- Skip dacă nu are `body` sau `type` nu este `conversation` sau `extendedText`
- **Log**: `[AutoReply] ⏭️  Gate 6 FAIL: no text or wrong type`

### Gate 7: Database disponibil
- Skip dacă Database nu este disponibil
- **Log**: `[AutoReply] ⏭️  Gate 7 FAIL: databaseAvailable={} db={}`

### Gate 8: Auto-reply enabled
- Verifică `accounts/{accountId}.autoReplyEnabled` (account-level)
- Verifică `threads/{threadId}.aiEnabled` (thread-level)
- Prioritate: thread-level > account-level
- **Log**: `[AutoReply] 🔍 Settings check: accountEnabled={} threadEnabled={} isAiEnabled={}`

### Gate 9: Comenzi speciale
- Dacă mesajul este "stop" sau "dezactiveaza", dezactivează auto-reply pentru thread
- **Log**: `[AutoReply] 🛑 Command detected: disabling auto-reply`

### Gate 10: Cooldown per thread
- Skip dacă ultimul răspuns a fost în ultimele 10 secunde (`AI_REPLY_COOLDOWN_MS = 10 * 1000`)
- Verifică `threads/{threadId}.aiLastReplyAt`
- **Log**: `[AutoReply] ⏭️  Gate 10 FAIL: thread cooldown active ({remaining}s remaining)`

### Gate 11: Cooldown per clientJid
- Skip dacă ultimul răspuns la același contact a fost în ultimele 10 secunde
- Verifică `threads/{threadId}.autoReplyLastClientReplyAt`
- **Log**: `[AutoReply] ⏭️  Gate 11 FAIL: clientJid cooldown active ({remaining}s remaining)`

### Gate 12: GROQ_API_KEY disponibil
- Skip dacă `GROQ_API_KEY` nu este setat
- **Log**: `[AutoReply] ⏭️  Gate 12 FAIL: GROQ_API_KEY not configured`

### Gate 13: Socket disponibil
- Verifică că `sock.sendMessage` este disponibil
- **Log**: `[AutoReply] ⏭️  Gate 13 FAIL: sock not available`

## 🔄 Fluxul Auto-Reply

```
1. Mesaj inbound primit
   ↓
2. handleMessagesUpsert() → saveMessageToDatabase()
   ↓
3. FCM notification (non-blocking)
   ↓
4. maybeHandleAiAutoReply() - toate gate-urile
   ↓
5. Construiește context (ultimele 10 mesaje)
   ↓
6. Generează prompt (thread > account > env > default)
   ↓
7. Call Groq API
   ↓
8. Trimite răspuns via sock.sendMessage()
   ↓
9. Salvează mesaj outbound în Database
   ↓
10. Actualizează cooldown-uri (thread + clientJid)
```

## 📊 Observabilitate

### Logs Structurate

**Entry Point**:
```
[AutoReply] 🔍 Entry: account={hash} msg={hash} saved={bool} eventType={type}
```

**Gate Failures**:
```
[AutoReply] ⏭️  Gate {N} FAIL: {reason}
```

**Settings Check**:
```
[AutoReply] 🔍 Settings check: accountEnabled={bool} threadEnabled={bool} isAiEnabled={bool}
```

**AI Call**:
```
[AutoReply] 🤖 Calling Groq API: historyLength={N} promptLength={N}
```

**Sending**:
```
[AutoReply] 📤 Sending reply: account={hash} to={hash} replyLen={N}
```

**Success**:
```
🤖 [AutoReply] ✅ SUCCESS: account={hash} thread={hash} jid=@{suffix} msg={hash} replyLen={N} aiLatency={ms}ms totalLatency={ms}ms
```

**Errors**:
```
[AutoReply] ❌ ERROR: account={hash} msg={hash} error={message}
[AutoReply] Stack: {stack}
```

### Database Fields

**Thread Document** (`threads/{threadId}`):
- `aiEnabled`: boolean (thread-level override)
- `aiSystemPrompt`: string (thread-level prompt)
- `aiLastReplyAt`: Timestamp (ultimul răspuns pentru thread)
- `autoReplyLastClientReplyAt`: Timestamp (ultimul răspuns pentru clientJid)
- `autoReplyLastMessageId`: string (ID-ul mesajului la care s-a răspuns)

**Account Document** (`accounts/{accountId}`):
- `autoReplyEnabled`: boolean (account-level setting)
- `autoReplyPrompt`: string (account-level prompt)

**Outbound Message** (`threads/{threadId}/messages/{messageId}`):
- `autoReply`: boolean (true pentru mesaje generate automat)
- `autoReplyToMessageId`: string (ID-ul mesajului original)

## ⚙️ Configurare

### 1. Activează Auto-Reply (Flutter App)

În Flutter app, navighează la:
- **WhatsApp Inbox Screen** → Settings → **Auto-Reply Toggle**
- **AI Settings Screen** → Configurează prompt-ul

Sau direct în Database:
```javascript
// Account-level (pentru toate thread-urile)
await db.collection('accounts').doc(accountId).set({
  autoReplyEnabled: true,
  autoReplyPrompt: 'Ești un asistent WhatsApp. Răspunzi politicos, scurt și clar în română.'
}, { merge: true });

// Thread-level (override pentru un thread specific)
await db.collection('threads').doc(threadId).set({
  aiEnabled: true,
  aiSystemPrompt: 'Prompt personalizat pentru acest thread'
}, { merge: true });
```

### 2. Configurează GROQ_API_KEY

Pe server (Hetzner):
```bash
# Setează în environment file
echo "GROQ_API_KEY=gsk_YOUR_GROQ_API_KEY_HERE" | sudo tee -a /etc/whatsapp-backend/supabase-sa.env

# Restart service
sudo systemctl restart whatsapp-backend
```

### 3. Environment Variables

```bash
# Obligatoriu
GROQ_API_KEY=your_groq_api_key_here

# Opțional (default-uri)
AI_DEFAULT_SYSTEM_PROMPT="Ești un asistent WhatsApp. Răspunzi politicos, scurt și clar în română."
```

## 🧪 Testare

### Test Manual

1. **Activează auto-reply în Flutter app**:
   - Deschide WhatsApp Inbox
   - Activează toggle-ul "Auto-Reply"
   - Configurează prompt-ul (opțional)

2. **Trimite mesaj de test**:
   - Trimite un mesaj la numărul WhatsApp conectat
   - Așteaptă 5-10 secunde

3. **Monitorizează logs**:
   ```bash
   ssh -i ~/.ssh/hetzner_whatsapp root@37.27.34.179 "sudo journalctl -u whatsapp-backend -f --no-pager" | grep -E "AutoReply|🤖"
   ```

4. **Verifică în Flutter app**:
   - Deschide conversația
   - Ar trebui să vezi răspunsul automat

### Test cu Dry-Run (pentru development)

Adaugă flag `DRY_RUN_AUTO_REPLY=true` în environment pentru a loga fără a trimite efectiv mesaje.

## 📝 Constante Configurabile

```javascript
const AI_REPLY_COOLDOWN_MS = 10 * 1000;        // 10 secunde
const AI_REPLY_MAX_CHARS = 500;                 // Max 500 caractere
const AI_REPLY_DEDUPE_TTL_MS = 10 * 60 * 1000; // 10 minute
const AI_FRESH_WINDOW_MS = 2 * 60 * 1000;      // 2 minute
```

## 🔧 Troubleshooting

### Auto-reply nu funcționează

1. **Verifică logs**:
   ```bash
   ssh -i ~/.ssh/hetzner_whatsapp root@37.27.34.179 "sudo journalctl -u whatsapp-backend --since '5 minutes ago' --no-pager" | grep -E "AutoReply"
   ```

2. **Verifică gate-urile**:
   - Caută `Gate {N} FAIL` pentru a vedea care gate oprește execuția

3. **Verifică setările**:
   ```bash
   # Verifică account settings
   # Verifică thread settings
   # Verifică GROQ_API_KEY
   ```

4. **Verifică cooldown-uri**:
   - Thread cooldown: `threads/{threadId}.aiLastReplyAt`
   - ClientJid cooldown: `threads/{threadId}.autoReplyLastClientReplyAt`

### Mesajele nu sunt trimise

1. **Verifică socket**:
   - Log: `[AutoReply] ⏭️  Gate 13 FAIL: sock not available`

2. **Verifică outbox worker**:
   - Dacă mesajul este în outbox dar nu este trimis, verifică outbox worker logs

## 📁 Fișiere Modificate

1. **`server.js`**:
   - Funcția `maybeHandleAiAutoReply` (linia 500) - refactorizată complet
   - Handler `handleMessagesUpsert` (linia 758) - trigger auto-reply după FCM

## 🎯 Gap-uri Identificate și Rezolvate

### Gap-uri Existente:
1. ❌ **Funcția `maybeHandleAiAutoReply` nu era apelată** - Rezolvat: trigger adăugat în `handleMessagesUpsert`
2. ❌ **Lipsea cooldown per clientJid** - Rezolvat: adăugat `autoReplyLastClientReplyAt`
3. ❌ **Lipsea logging detaliat** - Rezolvat: logging structurat pentru fiecare gate
4. ❌ **Lipsea salvarea mesajelor outbound** - Rezolvat: mesajele auto-reply sunt salvate în Database
5. ❌ **Lipsea error handling robust** - Rezolvat: try-catch complet cu logging

### Implementări Noi:
1. ✅ **13 gate-uri de securitate** - toate implementate
2. ✅ **Cooldown dual** - per thread și per clientJid
3. ✅ **Logging structurat** - pentru observabilitate completă
4. ✅ **Error handling** - nu oprește procesarea altor mesaje
5. ✅ **Persistență outbound** - mesajele auto-reply sunt salvate în Database

## 🚀 Cum Activezi Feature-ul

### Opțiunea 1: Flutter App (Recomandat)
1. Deschide Flutter app
2. Navighează la **WhatsApp Inbox**
3. Apasă pe **Settings** (iconița de setări)
4. Activează **Auto-Reply Toggle**
5. (Opțional) Configurează prompt-ul în **AI Settings**

### Opțiunea 2: Database Direct
```javascript
// Account-level (toate thread-urile)
db.collection('accounts').doc('account_prod_26ec0bfb54a6ab88cc3cd7aba6a9a443').set({
  autoReplyEnabled: true,
  autoReplyPrompt: 'Ești un asistent WhatsApp. Răspunzi politicos, scurt și clar în română.'
}, { merge: true });
```

## 📊 Monitoring

### Comenzi Utile

**Watch logs în timp real**:
```bash
ssh -i ~/.ssh/hetzner_whatsapp root@37.27.34.179 "sudo journalctl -u whatsapp-backend -f --no-pager" | grep -E "AutoReply|🤖"
```

**Verifică ultimele auto-reply-uri**:
```bash
ssh -i ~/.ssh/hetzner_whatsapp root@37.27.34.179 "sudo journalctl -u whatsapp-backend --since '10 minutes ago' --no-pager" | grep -E "🤖.*AutoReply.*SUCCESS"
```

**Verifică gate failures**:
```bash
ssh -i ~/.ssh/hetzner_whatsapp root@37.27.34.179 "sudo journalctl -u whatsapp-backend --since '10 minutes ago' --no-pager" | grep -E "AutoReply.*Gate.*FAIL"
```

## ✅ Checklist Final

- [x] Mesaje inbound procesate corect
- [x] Mesaje outbound trimise corect
- [x] AI integration funcțională (Groq)
- [x] Toate gate-urile implementate
- [x] Cooldown per thread și per clientJid
- [x] Logging complet
- [x] Error handling robust
- [x] Persistență outbound messages
- [x] Documentație completă

## 🎉 Status: IMPLEMENTAT COMPLET

Auto-reply-ul este funcțional end-to-end cu toate gate-urile de securitate și observabilitate necesare.
