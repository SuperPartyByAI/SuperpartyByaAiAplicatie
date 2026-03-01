# Comprehensive Auto-Reply Fix - Implementation Summary

## Overview

Această documentație descrie modificările complete pentru sistemul de auto-reply WhatsApp, incluzând:
- Canonicalizare threadId pentru eliminarea duplicatelor
- Mutarea promptului AI în Database (fără hardcode)
- Îmbunătățirea contextului AI cu contact info și metadata
- Name capture logic cu gestionare nume multiple
- Logging complet fără emoji cu traceId

## Modificări Implementate

### A) Thread Canonicalization + Anti-Duplicate

#### Funcții noi/modificate:

1. **`normalizePhone(input)`** (linia ~123)
   - Păstrează doar cifrele (fără +, fără spații)
   - Returnează `null` dacă input este invalid

2. **`canonicalClientKey(remoteJid, accountId)`** (linia ~137)
   - Pentru `@s.whatsapp.net`: extrage digits și returnează `${digits}@s.whatsapp.net`
   - Pentru `@lid`: încearcă să rezolve phone din mapping file
   - Pentru grupuri: returnează JID-ul original
   - Returnează: `{canonicalKey, phoneDigits, phoneE164}`

3. **`buildCanonicalThreadId(accountId, canonicalKey)`** (linia ~194)
   - Construiește threadId canonical: `${accountId}__${canonicalKey}`

4. **`findExistingThreadByPhone(accountId, phoneDigits, phoneE164)`** (linia ~206)
   - **IMPORTANT**: Folosește `autoReplyLastClientReplyAt` sau `updatedAt` sau `createdAt` pentru a alege thread-ul cel mai recent
   - Caută în `phoneE164` și `phone` fields
   - Returnează thread-ul cu cea mai recentă interacțiune

#### Logic în `maybeHandleAiAutoReply`:

- La început: calculează `canonicalKey`, `phoneDigits`, `phoneE164` și `canonicalThreadId`
- Dacă `threadDoc.exists=false` și avem `phoneDigits`:
  - Apelează `findExistingThreadByPhone` pentru a găsi thread existent
  - Dacă găsește, folosește `actualThreadId` = thread-ul găsit
  - Loghează `pickedExistingThread=true`
- Toate scrierile în Database folosesc `actualThreadId` (nu `threadId` vechi)

### B) Prompt AI doar în Database (fără hardcode)

#### Prioritatea promptului:

1. `threads/{threadId}.aiSystemPrompt` (override per contact)
2. `accounts/{accountId}.autoReplyPrompt` (default per account)
3. `process.env.AI_DEFAULT_SYSTEM_PROMPT` (fallback de urgență)
4. Dacă nu există niciuna => **throw Error** (nu mai există hardcoded fallback)

#### Auto-set prompt în Database:

- Când `accountDoc.autoReplyPrompt` lipsește sau e gol:
  - Încearcă să încarce din `process.env.AI_SECURITY_PROMPT_TEMPLATE`
  - Dacă env lipsește, folosește un template minimal (doar pentru auto-set inițial)
  - Salvează în `accounts/{accountId}.autoReplyPrompt`
  - Loghează: `[AutoReply][Prompt] traceId=... autoSetSecurityPrompt promptSource=env|fallback`

#### Logging prompt:

- `promptSource=thread|account|env`
- `promptLength` (număr caractere)
- `promptHash` (sha256 primele 8 caractere, nu textul complet)

### C) Context AI îmbunătățit

#### Configurare:

- `AI_CONTEXT_MESSAGE_LIMIT` din env, default 50
- Construiește context cu ultimele N mesaje (N configurabil)

#### Metadata adăugată:

- Data primului mesaj din thread (`firstMessageDate`)
- Număr total mesaje în thread (`messageCount`)
- Câte mesaje sunt trimise ca context

#### Contact info în prompt:

- `firstName` (preferat) sau `displayName` (doar backward compatibility)
- **NU folosește telefon ca nume** pentru adresare
- Telefon: `phoneE164` sau digits
- Tip: telefon / grup / linked device

#### Funcție `buildEnrichedSystemPrompt`:

- Concatenează promptul de bază cu:
  - Contact context (nume, telefon, tip)
  - Conversation metadata (data început, total mesaje, context size)

### D) Name Capture (nu folosește numărul ca nume)

#### Logic flow:

1. **Dacă `threadData.firstName` nu există**:
   - AI întreabă: "Salut! Cum te numești? 😊"
   - Setează `pendingNameRequest=true` în thread
   - **RETURN** (nu cheamă AI)

2. **Când `pendingNameRequest=true` și utilizatorul răspunde**:
   - Extrage numele cu `extractNameFromMessage(text)`
   - Salvează `fullName` exact cum spune utilizatorul
   - **Dacă are 1-2 cuvinte**:
     - Extrage `firstName` (prenumele) cu heuristics pentru "Ursache Andrei" (ordine inversă)
     - Salvează `firstName` și `fullName`
     - Confirmă: "Mulțumesc, {firstName}! 😊"
     - Setează `pendingNameRequest=false`
   - **Dacă are 3+ cuvinte**:
     - Salvează doar `fullName`
     - Setează `pendingPreferredName=true`
     - Întreabă: "Văd că ai mai multe nume ({fullName}). Cum îți place să îți spun? 😊"
     - **RETURN** (nu cheamă AI)

3. **Când `pendingPreferredName=true`**:
   - Extrage numele preferat cu `extractPreferredNameFromMessage(text)`
   - Salvează `firstName=preferredName`
   - Confirmă: "Perfect, {preferredName}! 😊"
   - Setează `pendingPreferredName=false`

#### Heuristics pentru "Ursache Andrei" (ordine inversă):

- Pentru 2 cuvinte, verifică dacă ultimul cuvânt se termină cu ending-uri comune de prenume românesc (`u`, `a`, `e`, `i`, `o`, `ă`, `â`, `î`)
- Dacă da și primul nu, folosește ultimul ca `firstName` (reverse order)
- Altfel, folosește primul (normal order)

#### În conversații:

- Folosește **doar `firstName`** pentru adresare
- **NU folosește telefon** ca fallback pentru nume
- Dacă nu există nume, folosește "tu" (generic fallback, dar nu ar trebui să se întâmple)

### E) Logging / Diagnoză

#### Format logging:

- **Fără emoji în tag-uri**: `[AutoReply][Trace]`, `[AutoReply][Skip]`, `[AutoReply][Name]`, `[AutoReply][Prompt]`, `[AutoReply][AI]`, `[AutoReply][Send]`, `[AutoReply][Error]`
- **Fiecare mesaj inbound are `traceId`**: `messageId` sau `trace_${timestamp}_${random}`

#### Loguri înainte de Database read:

```
[AutoReply][Trace] traceId=... accountId=... incomingRemoteJid=... canonicalKey=... phoneDigits=... phoneE164=... canonicalThreadId=... computedThreadId=...
```

#### Loguri după Database read:

```
[AutoReply][Trace] traceId=... threadDataLoaded actualThreadId=... exists=true|false pickedExisting=true|false hasFirstName=true|false hasDisplayName=true|false hasPendingNameRequest=true|false hasPendingPreferredName=true|false
```

#### Loguri pentru skip:

```
[AutoReply][Skip] traceId=... reason=skipped_fromMe|skipped_group|skipped_cooldown|... accountId=... threadId=... clientJid=...
```

#### Loguri pentru prompt:

```
[AutoReply][Trace] traceId=... promptSource=thread|account|env promptLength=... promptHash=... nameSource=firstName|displayName|fallback
```

### F) Ordinea "Gates"

Ordinea exactă a gate-urilor în `maybeHandleAiAutoReply`:

1. Validare input (msg, saved)
2. **fromMe check** (skip outbound)
3. **Group check** (skip grupuri)
4. **Invalid JID check**
5. **Event type check** (doar 'notify')
6. **Fresh message check** (în ultimele 2 minute)
7. **Dedupe check** (idempotency)
8. **Text message check** (doar conversation/extendedText)
9. **Database available check**
10. **Load thread data + fallback anti-duplicate**
11. **Settings check** (auto-reply enabled)
12. **Name capture gates** (înainte de AI):
    - Dacă nu are nume și nu e pending: întreabă numele → RETURN
    - Dacă e pendingPreferredName: procesează răspuns → RETURN
    - Dacă e pendingNameRequest: procesează răspuns → RETURN
13. **Command check** (stop/dezactiveaza)
14. **Cooldown checks** (thread + clientJid)
15. **GROQ_API_KEY check**
16. **Build context + prompt**
17. **Call AI**
18. **Validate reply** (complet, între min/max)
19. **Send reply**
20. **Save outbound message**

## Test Plan

### Test 1: Contact nou (fără firstName)

**Pași:**
1. Trimite mesaj de la un număr nou către WhatsApp conectat
2. Verifică logurile pentru canonicalizare și name request

**Comenzi:**
```bash
# Pe server
ssh -i ~/.ssh/hetzner_whatsapp root@37.27.34.179

# Monitorizează logurile
journalctl -u whatsapp-backend -f | grep -E '\[AutoReply\]|\[Trace\]|\[Name\]'
```

**Loguri așteptate:**
```
[AutoReply][Trace] traceId=... incomingRemoteJid=... canonicalKey=... phoneDigits=... phoneE164=...
[AutoReply][Trace] traceId=... threadDataLoaded exists=false pickedExisting=false hasFirstName=false
[AutoReply][Name] traceId=... needToAskName hasName=false pendingNameRequest=false
[AutoReply][Trace] traceId=... askedForName threadId=... phoneDigits=...
```

**Verificare:**
- Thread-ul este creat cu `phoneE164` și `phoneDigits` salvate
- Mesajul "Salut! Cum te numești? 😊" este trimis
- `pendingNameRequest=true` în Database

### Test 2: Răspuns cu nume (1-2 cuvinte)

**Pași:**
1. După Test 1, răspunde cu "Ion Popescu"
2. Verifică că firstName este salvat corect

**Loguri așteptate:**
```
[AutoReply][Trace] traceId=... nameCheck hasName=false pendingNameRequest=true
[AutoReply][Name] traceId=... savedContactName firstName=Ion fullName=Ion Popescu
```

**Verificare:**
- `firstName=Ion` în Database
- `fullName=Ion Popescu` în Database
- `pendingNameRequest=false`
- Mesajul "Mulțumesc, Ion! 😊" este trimis

### Test 3: Răspuns cu nume (ordine inversă: "Ursache Andrei")

**Pași:**
1. Contact nou, răspunde cu "Ursache Andrei"
2. Verifică că firstName este "Andrei" (nu "Ursache")

**Loguri așteptate:**
```
[AutoReply][Name] traceId=... savedContactName firstName=Andrei fullName=Ursache Andrei
```

**Verificare:**
- `firstName=Andrei` (corect, nu "Ursache")
- `fullName=Ursache Andrei`

### Test 4: Răspuns cu nume multiple (3+ cuvinte)

**Pași:**
1. Contact nou, răspunde cu "Ion Gigi Matei Popescu"
2. Verifică că se cere nume preferat

**Loguri așteptate:**
```
[AutoReply][Name] traceId=... askedForPreferredName fullName=Ion Gigi Matei Popescu
```

**Verificare:**
- `fullName=Ion Gigi Matei Popescu` salvat
- `pendingPreferredName=true`
- Mesajul "Văd că ai mai multe nume (Ion Gigi Matei Popescu). Cum îți place să îți spun? 😊" este trimis

### Test 5: Răspuns cu nume preferat

**Pași:**
1. După Test 4, răspunde cu "Gigi"
2. Verifică că firstName este salvat

**Loguri așteptate:**
```
[AutoReply][Name] traceId=... savedPreferredName preferredName=Gigi
```

**Verificare:**
- `firstName=Gigi` salvat
- `pendingPreferredName=false`
- Mesajul "Perfect, Gigi! 😊" este trimis

### Test 6: Același contact cu variații (+40 vs 40)

**Pași:**
1. Trimite mesaj de la `+40768098268@s.whatsapp.net`
2. Apoi trimite mesaj de la `40768098268@s.whatsapp.net` (fără +)
3. Verifică că se folosește același thread (nu se creează duplicate)

**Loguri așteptate:**
```
# Primul mesaj
[AutoReply][Trace] traceId=... canonicalKey=40768098268@s.whatsapp.net phoneDigits=40768098268 phoneE164=+40768098268
[AutoReply][Trace] traceId=... threadDataLoaded exists=false willCreateNew

# Al doilea mesaj (același contact, format diferit)
[AutoReply][Trace] traceId=... canonicalKey=40768098268@s.whatsapp.net phoneDigits=40768098268 phoneE164=+40768098268
[AutoReply][Trace] traceId=... pickedExistingThread threadId=... phoneDigits=40768098268
```

**Verificare:**
- Ambele mesaje folosesc același `canonicalThreadId`
- Al doilea mesaj găsește thread-ul existent (nu creează duplicat)
- `pickedExistingThread=true` în loguri

### Test 7: @lid JID cu phone resolution

**Pași:**
1. Trimite mesaj de la un contact cu JID `@lid`
2. Verifică că phone-ul este rezolvat din mapping și thread-ul este canonicalizat

**Loguri așteptate:**
```
[AutoReply][Trace] traceId=... incomingRemoteJid=...@lid canonicalKey=40768098268@s.whatsapp.net phoneDigits=40768098268 phoneE164=+40768098268
```

**Verificare:**
- `canonicalKey` este `40768098268@s.whatsapp.net` (nu `@lid`)
- `phoneDigits` și `phoneE164` sunt populate
- Thread-ul este creat cu `canonicalThreadId` bazat pe phone, nu pe @lid

### Test 8: Prompt source logging

**Pași:**
1. Trimite mesaj inbound
2. Verifică logurile pentru prompt source

**Loguri așteptate:**
```
[AutoReply][Trace] traceId=... promptSource=account|thread|env promptLength=... promptHash=... nameSource=firstName|displayName|fallback
```

**Verificare:**
- `promptSource` indică de unde vine promptul (account/thread/env)
- `promptHash` este hash-ul (nu textul complet)
- `promptLength` este lungimea în caractere

### Test 9: Fallback anti-duplicate

**Pași:**
1. Creează manual un thread în Database cu `phoneE164=+40768098268` dar `threadId` diferit de canonical
2. Trimite mesaj de la același telefon
3. Verifică că se găsește thread-ul existent

**Loguri așteptate:**
```
[AutoReply][Trace] traceId=... threadDocMissing attemptingFallback phoneDigits=40768098268 phoneE164=+40768098268
[AutoReply][Trace] traceId=... pickedExistingThread threadId=... phoneDigits=40768098268
```

**Verificare:**
- Thread-ul existent este găsit prin `findExistingThreadByPhone`
- `pickedExistingThread=true`
- Nu se creează thread nou

### Test 10: AI reply complet (nu tăiat)

**Pași:**
1. Trimite mesaj inbound cu întrebare
2. Verifică că răspunsul AI este complet (se termină cu propoziție)

**Loguri așteptate:**
```
[AutoReply][AI] traceId=... callingGroqApi historyLength=... promptLength=...
[AutoReply][Validate] Message complete and valid: ... chars (ends with sentence)
[AutoReply][Send] traceId=... sendingReply replyLen=...
```

**Verificare:**
- Răspunsul se termină cu `.`, `!` sau `?`
- Răspunsul este între `AI_REPLY_MIN_CHARS` și `AI_REPLY_MAX_CHARS`
- Nu este trunchiat

## Comenzi Utile pentru Debugging

### Monitorizare loguri în timp real:
```bash
ssh -i ~/.ssh/hetzner_whatsapp root@37.27.34.179
journalctl -u whatsapp-backend -f | grep -E '\[AutoReply\]'
```

### Căutare după traceId:
```bash
journalctl -u whatsapp-backend --since '10 minutes ago' | grep 'traceId=ABC123'
```

### Verificare canonicalizare:
```bash
journalctl -u whatsapp-backend --since '10 minutes ago' | grep -E 'canonicalKey|pickedExistingThread|phoneDigits'
```

### Verificare name capture:
```bash
journalctl -u whatsapp-backend --since '10 minutes ago' | grep -E '\[Name\]|needToAskName|savedContactName|savedPreferredName'
```

### Verificare prompt source:
```bash
journalctl -u whatsapp-backend --since '10 minutes ago' | grep -E 'promptSource|promptHash|autoSetSecurityPrompt'
```

## Verificare Database

### Verificare thread cu phone fields:
```javascript
// În Supabase Console sau script
const threadDoc = await db.collection('threads').doc('account_prod_xxx__40768098268@s.whatsapp.net').get();
const data = threadDoc.data();
console.log({
  phoneE164: data.phoneE164,
  phone: data.phone,
  phoneNumber: data.phoneNumber,
  phoneDigits: data.phoneDigits, // dacă există
  firstName: data.firstName,
  displayName: data.displayName,
  fullName: data.fullName,
  pendingNameRequest: data.pendingNameRequest,
  pendingPreferredName: data.pendingPreferredName
});
```

### Verificare prompt în account:
```javascript
const accountDoc = await db.collection('accounts').doc('account_prod_xxx').get();
const data = accountDoc.data();
console.log({
  hasAutoReplyPrompt: !!data.autoReplyPrompt,
  promptLength: data.autoReplyPrompt?.length || 0,
  promptPreview: data.autoReplyPrompt?.substring(0, 100) || 'none'
});
```

## Deployment

### Deploy pe Hetzner:
```bash
cd /Users/universparty/Aplicatie-SuperpartyByAi/whatsapp-backend
scp -i ~/.ssh/hetzner_whatsapp server.js root@37.27.34.179:/opt/whatsapp/whatsapp-backend/server.js
ssh -i ~/.ssh/hetzner_whatsapp root@37.27.34.179 "sudo systemctl restart whatsapp-backend && sleep 3 && sudo systemctl status whatsapp-backend"
```

### Verificare serviciu:
```bash
ssh -i ~/.ssh/hetzner_whatsapp root@37.27.34.179 "sudo systemctl status whatsapp-backend"
```

### Verificare loguri după restart:
```bash
ssh -i ~/.ssh/hetzner_whatsapp root@37.27.34.179 "journalctl -u whatsapp-backend --since '2 minutes ago' --no-pager | tail -50"
```

## Environment Variables

### Variabile necesare:

- `GROQ_API_KEY` - Cheia API pentru Groq (obligatoriu)
- `AI_DEFAULT_SYSTEM_PROMPT` - Fallback prompt dacă nu există în Database (opțional, dar recomandat)
- `AI_SECURITY_PROMPT_TEMPLATE` - Template pentru auto-set prompt în Database (opțional)
- `AI_CONTEXT_MESSAGE_LIMIT` - Număr mesaje în context (default: 50)
- `AI_REPLY_MIN_CHARS` - Min caractere pentru răspuns (default: 50)
- `AI_REPLY_MAX_CHARS` - Max caractere pentru răspuns (default: 240)
- `AI_REPLY_COOLDOWN_MS` - Cooldown între răspunsuri (default: 10000ms = 10s)

## Exemple de Loguri Complete

### Exemplu 1: Contact nou, name request
```
[AutoReply][Trace] traceId=ABC123 accountId=hash:8 incomingRemoteJid=hash:15 canonicalKey=40768098268@s.whatsapp.net phoneDigits=40768098268 phoneE164=+40768098268 canonicalThreadId=hash:50 computedThreadId=hash:50
[AutoReply][Trace] traceId=ABC123 databaseQueriesCompleted threadDocPath=threads/account_prod_xxx__40768098268@s.whatsapp.net threadDocExists=false
[AutoReply][Trace] traceId=ABC123 threadDocMissing attemptingFallback phoneDigits=40768098268 phoneE164=+40768098268
[AutoReply][Trace] traceId=ABC123 noExistingThreadFound phoneDigits=40768098268 phoneE164=+40768098268 willCreateNew
[AutoReply][Trace] traceId=ABC123 threadDataLoaded actualThreadId=hash:50 exists=false pickedExisting=false hasFirstName=false hasDisplayName=false hasPendingNameRequest=false hasPendingPreferredName=false
[AutoReply][Name] traceId=ABC123 needToAskName hasName=false pendingNameRequest=false pendingPreferredName=false
[AutoReply][Trace] traceId=ABC123 askedForName threadId=hash:50 phoneDigits=40768098268
```

### Exemplu 2: Răspuns cu nume, apoi AI reply
```
[AutoReply][Trace] traceId=DEF456 accountId=hash:8 incomingRemoteJid=hash:15 canonicalKey=40768098268@s.whatsapp.net phoneDigits=40768098268 phoneE164=+40768098268
[AutoReply][Trace] traceId=DEF456 threadDataLoaded actualThreadId=hash:50 exists=true pickedExisting=false hasFirstName=true hasDisplayName=true hasPendingNameRequest=false
[AutoReply][Trace] traceId=DEF456 nameCheck hasName=true firstName=Ion displayName=Ion pendingNameRequest=false nameSource=firstName
[AutoReply][Trace] traceId=DEF456 allGatesPassed generatingReply actualThreadId=hash:50
[AutoReply][Trace] traceId=DEF456 promptSource=account promptLength=1234 promptHash=a1b2c3d4 nameSource=firstName
[AutoReply][AI] traceId=DEF456 callingGroqApi historyLength=5 promptLength=1500
[AutoReply][Validate] Message complete and valid: 120 chars (ends with sentence)
[AutoReply][Send] traceId=DEF456 sendingReply accountId=hash:8 clientJid=hash:15 replyLen=120
[AutoReply][Trace] traceId=DEF456 success accountId=hash:8 actualThreadId=hash:50 jid=@s.whatsapp.net msg=hash:12 replyLen=120 aiLatency=500ms totalLatency=800ms pickedExistingThread=false
```

### Exemplu 3: Picked existing thread (anti-duplicate)
```
[AutoReply][Trace] traceId=GHI789 accountId=hash:8 incomingRemoteJid=hash:15 canonicalKey=40768098268@s.whatsapp.net phoneDigits=40768098268 phoneE164=+40768098268
[AutoReply][Trace] traceId=GHI789 threadDocMissing attemptingFallback phoneDigits=40768098268 phoneE164=+40768098268
[AutoReply][Trace] traceId=GHI789 pickedExistingThread threadId=hash:50 phoneDigits=40768098268 phoneE164=+40768098268
[AutoReply][Trace] traceId=GHI789 threadDataLoaded actualThreadId=hash:50 exists=true pickedExisting=true hasFirstName=true
```

## Troubleshooting

### Problemă: Thread-uri duplicate încă se creează

**Verificare:**
1. Verifică că `canonicalClientKey` returnează același `canonicalKey` pentru același telefon
2. Verifică că `findExistingThreadByPhone` caută corect în `phoneE164` și `phone`
3. Verifică că thread-urile existente au `phoneE164` sau `phone` populate

**Fix:**
- Rulează un script de migrare pentru a popula `phoneE164`/`phone` în thread-urile existente

### Problemă: AI nu răspunde

**Verificare:**
1. Verifică logurile pentru `skipReason`
2. Verifică că `GROQ_API_KEY` este setat
3. Verifică că promptul există în Database sau env
4. Verifică că `autoReplyEnabled=true` în account sau `aiEnabled=true` în thread

### Problemă: Name capture nu funcționează

**Verificare:**
1. Verifică logurile pentru `[Name]` tags
2. Verifică că `hasName` este evaluat corect (doar pe `firstName`, nu `displayName`)
3. Verifică că `extractNameFromMessage` returnează rezultat valid

### Problemă: Prompt hardcodat încă apare

**Verificare:**
1. Verifică că nu mai există fallback hardcodat în cod (doar în env)
2. Verifică că `AI_DEFAULT_SYSTEM_PROMPT` este setat în env dacă nu există prompt în Database
3. Verifică logurile pentru `promptSource` - ar trebui să fie `account`, `thread`, sau `env`, nu `fallback`

## Concluzie

Toate cerințele au fost implementate:
- ✅ Thread canonicalization cu anti-duplicate fallback
- ✅ Prompt doar în Database (fără hardcode, cu auto-set)
- ✅ Context AI îmbunătățit cu contact info și metadata
- ✅ Name capture logic complet cu gestionare nume multiple
- ✅ Logging complet fără emoji cu traceId
- ✅ Toate thread writes folosesc `actualThreadId` și salvează phone fields

Sistemul este gata pentru testare și deployment.
