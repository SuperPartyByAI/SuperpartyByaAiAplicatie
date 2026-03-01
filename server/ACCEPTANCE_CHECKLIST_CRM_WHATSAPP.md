# Acceptance Checklist - CRM WhatsApp (Scripted QA)

**Date:** 2026-01-17  
**Scope:** 10 teste "cap-coadă" pentru WhatsApp → Database → CRM → AI  
**Format:** Pas UI → API Call → Database Check → Expected

---

## ✅ **Migration – WhatsApp CRM (GetMessages removed, Send via proxy)**

Use this **before** full CRM tests to confirm the migrated flow.

| Step | Action | Success |
|------|--------|---------|
| **Inbox refresh** | App → WhatsApp → Inbox → pull-to-refresh | Threads refresh from Database; no HTTP error |
| **Chat stream Database** | Inbox → tap thread → Chat | Messages load from `threads/{threadId}/messages` stream; "No messages yet" if empty |
| **Send via proxy** | Chat → type message → Send | Logs: `sendViaProxy` / `whatsappProxySend`; 2xx JSON response; "Message sent!" snackbar |
| **No GetMessages** | Check debug logs while using Inbox/Chat | Zero requests to `whatsappProxyGetMessages` |

**Config:** `WHATSAPP_BACKEND_URL` (or `WHATSAPP_BACKEND_BASE_URL`) set in Functions secrets; `whatsappProxySend` deployed.

---

## 🔧 **0. Precondiții (Obligatoriu Înainte de Orice)**

### **0.1 Hetzner Backend (WhatsApp)**

| Pas | Acțiune | Verificare | Expected |
|-----|---------|------------|----------|
| 0.1.1 | Persistent storage: `/var/lib/whatsapp-backend/sessions` | SSH → `ls -la /var/lib/whatsapp-backend/sessions` | ✅ Directory există și e writable |
| 0.1.2 | Env var: `SESSIONS_PATH=/var/lib/whatsapp-backend/sessions` | SSH → `systemctl show whatsapp-backend -p Environment` | ✅ `/var/lib/whatsapp-backend/sessions` |
| 0.1.3 | Env var: `SUPABASE_SERVICE_ACCOUNT_JSON=...` | SSH → `systemctl show whatsapp-backend -p Environment` | ✅ JSON valid (nu `null`) |
| 0.1.4 | (Opțional) Env var: `ADMIN_TOKEN=...` | SSH → `systemctl show whatsapp-backend -p Environment` | ✅ Token setat dacă e folosit |
| 0.1.5 | Deploy Hetzner → verifică logs: `sessions dir exists/writable true` | SSH → `journalctl -u whatsapp-backend -n 50` | ✅ `sessions dir exists/writable true` |
| 0.1.6 | Health check | `GET https://whats-app-ompro.ro/health` | ✅ `sessions_dir_writable=true`, status 200 |

**Hetzner Domain:** `https://whats-app-ompro.ro` (production)

---

### **0.2 Supabase**

| Pas | Acțiune | Verificare | Expected |
|-----|---------|------------|----------|
| 0.2.1 | Deploy indexes: `supabase deploy --only database:indexes` | Terminal: `supabase deploy --only database:indexes` | ✅ `Deploy complete!` |
| 0.2.2 | Verifică indexes în Console | Supabase Console → Database → Indexes | ✅ Toate "Ready" (inclusiv `evenimente` pe `phoneE164`) |
| 0.2.3 | Verifică rules: `clients/{phoneE164}` | Supabase Console → Database → Rules → Căutare `clients` | ✅ `allow delete: if false` |

---

### **0.3 Flutter App**

| Pas | Acțiune | Verificare | Expected |
|-----|---------|------------|----------|
| 0.3.1 | Login în app (Supabase Auth) | App → Login screen → autentificare | ✅ `Authorization: Bearer <token>` e trimis la backend |
| 0.3.2 | (Opțional) Verifică backend URL | App → Settings / Config → `WHATSAPP_BACKEND_URL` | ✅ `https://whats-app-ompro.ro` (Hetzner production) |

**⚠️ Note:** Dacă Inbox/Chat lipsesc din UI, actualizează app la versiunea care include WhatsApp Inbox/Chat/Client Profile înainte de Testele 3-6.

---

## ✅ **TEST 1: Pair Account (QR → Connected)**

**Scop:** Din aplicație generezi QR, scanezi, contul devine connected.

| Pas | UI Action | API Call (implicit) | Database Check | Expected |
|-----|-----------|---------------------|-----------------|----------|
| 1.1 | App → WhatsApp → Accounts | `GET /api/whatsapp/accounts` (via proxy Flutter) | - | ✅ Listă conturi (sau `[]`) |
| 1.2 | Apasă "Add Account" | `POST /api/whatsapp/add-account` (via proxy) | - | ✅ `{ accountId, status: "qr_ready", qrCode: "data:image/png;base64,..." }` |
| 1.3 | Vezi QR afișat în UI | `GET /api/whatsapp/qr/:accountId` (dacă e separat) | `accounts/{accountId}` → `status = "qr_ready"`, `qrCode` există | ✅ QR afișat (data URL) |
| 1.4 | Pe telefon: WhatsApp → Linked devices → Link a device → scanezi QR | - | - | ✅ QR scanat pe telefon |
| 1.5 | Refresh în UI (sau polling automat) | `GET /api/whatsapp/accounts` | `accounts/{accountId}` → `status = "connected"`, `qrCode = null` (sau șters) | ✅ Status = connected, QR dispare |
| 1.6 | Verificare Database (manual Console) | - | `accounts/{accountId}` → `status = "connected"`, `lastConnectedAt` timestamp | ✅ Document actualizat |

**Database Exact Check:**
```javascript
// Supabase Console → Database Database → Data → accounts/{accountId}
{
  accountId: "WA-01" (sau generat),
  status: "connected",
  lastConnectedAt: <timestamp>,
  qrCode: null // sau câmp șters
}
```

---

## ✅ **TEST 2: Persistență Sesiune (Restart Fără Re-pair)**

**Scop:** După redeploy/restart, nu cere QR din nou.

| Pas | UI Action | API Call | Database Check | Expected |
|-----|-----------|----------|-----------------|----------|
| 2.1 | (Pre-condiție) Contul e connected (Test 1) | - | `accounts/{accountId}` → `status = "connected"` | ✅ Pre-condiție satisfăcută |
| 2.2 | Hetzner → Restart service | SSH → `sudo systemctl restart whatsapp-backend` | - | ✅ Service restartat |
| 2.3 | App → WhatsApp → Accounts → Refresh | `GET /api/whatsapp/accounts` | `accounts/{accountId}` → `status = "connected"` (rămâne) | ✅ Status = connected, fără QR |
| 2.4 | Verificare logs Hetzner | SSH → `journalctl -u whatsapp-backend -n 100` | Logs: NU apare `needs_qr` imediat după boot | ✅ Nu apare `needs_qr` pentru contul connected |

**Database Exact Check:**
```javascript
// accounts/{accountId}
{
  status: "connected", // rămâne connected
  lastConnectedAt: <timestamp anterior>, // sau actualizat
  qrCode: null // sau șters
}
```

---

## ✅ **TEST 3: Thread Isolation (WA-01 vs WA-02 cu Același Client)**

**Scop:** Același client nu amestecă conversațiile între WA-01 și WA-02.

**⚠️ Pre-condiție:** Implementat Inbox/Chat screens în Flutter.

| Pas | UI Action | API Call | Database Check | Expected |
|-----|-----------|----------|-----------------|----------|
| 3.1 | Pair WA-02 (repetă Test 1 pentru WA-02) | `POST /api/whatsapp/add-account` (name=WA-02) | `accounts/{WA02_accountId}` → `status = "connected"` | ✅ WA-02 connected |
| 3.2 | Client (telefon Y) trimite "Salut" către WA-01 | - | - | ✅ Mesaj trimis din WhatsApp client |
| 3.3 | App → WhatsApp → Inbox → vezi thread WA-01 | `GET /api/whatsapp/threads/:accountId` (sau echivalent) | `threads/{WA01_accountId}__{clientJid}` → `lastMessageText = "Salut"` | ✅ Thread apare în Inbox |
| 3.4 | Client trimite "Salut" către WA-02 | - | - | ✅ Mesaj trimis din WhatsApp client |
| 3.5 | App → WhatsApp → Inbox → vezi thread WA-02 | `GET /api/whatsapp/threads/:accountId` | `threads/{WA02_accountId}__{clientJid}` → `lastMessageText = "Salut"` | ✅ Thread separat apare |
| 3.6 | Verificare Database (manual) | - | Există `threads/{WA01_accountId}__{clientJid}` și `threads/{WA02_accountId}__{clientJid}` (2 thread-uri diferite) | ✅ Thread-uri separate |

**Database Exact Check:**
```javascript
// threads/{WA01_accountId}__{clientJid}
{
  accountId: "WA-01",
  clientJid: "+40712345678@s.whatsapp.net", // exemplu
  lastMessageText: "Salut",
  lastMessageAt: <timestamp>
}

// threads/{WA02_accountId}__{clientJid} (THREAD SEPARAT)
{
  accountId: "WA-02",
  clientJid: "+40712345678@s.whatsapp.net", // același client, alt cont
  lastMessageText: "Salut",
  lastMessageAt: <timestamp>
}

// threads/{WA01_accountId}__{clientJid}/messages/{messageId}
{
  direction: "inbound",
  body: "Salut",
  accountId: "WA-01",
  clientJid: "+40712345678@s.whatsapp.net"
}

// threads/{WA02_accountId}__{clientJid}/messages/{messageId}
{
  direction: "inbound",
  body: "Salut",
  accountId: "WA-02", // DIFERIT
  clientJid: "+40712345678@s.whatsapp.net"
}
```

---

## ✅ **TEST 4: Inbound Persistence (Client → App → Database)**

**Scop:** Primești mesaj, îl vezi în aplicație, se salvează corect.

**⚠️ Pre-condiție:** Inbox/Chat screens implementate.

| Pas | UI Action | API Call | Database Check | Expected |
|-----|-----------|----------|-----------------|----------|
| 4.1 | Client (telefon) trimite mesaj către WA-01: "Test inbound" | - | - | ✅ Mesaj trimis din WhatsApp client |
| 4.2 | App → WhatsApp → Inbox → deschide thread client | `GET /api/whatsapp/messages/:accountId/:threadId` (sau echivalent) | - | ✅ Thread deschis în UI |
| 4.3 | Mesajul apare în Chat screen | (Polling sau real-time) | `threads/{threadId}/messages/{messageId}` → `direction = "inbound"`, `body = "Test inbound"` | ✅ Mesaj inbound apare în UI |
| 4.4 | Verificare Database (manual) | - | `threads/{threadId}` → `lastMessageAt` actualizat, `lastMessageText = "Test inbound"` | ✅ Thread actualizat |

**Database Exact Check:**
```javascript
// threads/{threadId}/messages/{messageId}
{
  messageId: <generat>,
  accountId: "WA-01",
  clientJid: "+40712345678@s.whatsapp.net",
  direction: "inbound",
  body: "Test inbound",
  tsClient: <timestamp>,
  createdAt: <timestamp>
}

// threads/{threadId}
{
  accountId: "WA-01",
  clientJid: "+40712345678@s.whatsapp.net",
  lastMessageAt: <timestamp>, // ACTUALIZAT
  lastMessageText: "Test inbound", // ACTUALIZAT
  lastMessageDirection: "inbound"
}
```

---

## ✅ **TEST 5: Outbound Send + Receipts (UI → Client → Status)**

**Scop:** Trimiți din aplicație, clientul primește, status se actualizează.

**⚠️ Pre-condiție:** Inbox/Chat screens + Send button implementat.

| Pas | UI Action | API Call | Database Check | Expected |
|-----|-----------|----------|-----------------|----------|
| 5.1 | App → WhatsApp → Chat → scrii "Test 123" → Send | `POST /api/whatsapp/send-message` (via proxy sau direct) | `outbox/{requestId}` → `status = "queued"`, `body = "Test 123"` | ✅ Outbox doc creat |
| 5.2 | Mesajul apare în UI (inițial queued/sent) | - | `threads/{threadId}/messages/{waMessageId}` → `status = "queued"` (sau `sent`) | ✅ Mesaj apare în UI cu status queued/sent |
| 5.3 | Pe telefonul clientului: confirmă primire | - | - | ✅ Client primește mesajul |
| 5.4 | Client deschide chat-ul (ca să apară "read") | - | - | ✅ Client citește mesajul |
| 5.5 | (După câteva secunde) Verificare Database | - | `outbox/{requestId}` → `status = "sent"` (sau `delivered`), `threads/{threadId}/messages/{waMessageId}` → `status` evoluează (`sent` → `delivered` → `read`) | ✅ Status actualizat |

**Database Exact Check:**
```javascript
// outbox/{requestId}
{
  requestId: <generat>,
  accountId: "WA-01",
  toJid: "+40712345678@s.whatsapp.net",
  threadId: "...",
  body: "Test 123",
  status: "sent", // sau "delivered"/"read"
  createdAt: <timestamp>
}

// threads/{threadId}/messages/{waMessageId}
{
  direction: "outbound",
  body: "Test 123",
  status: "sent", // evoluează: queued → sent → delivered → read
  deliveredAt: <timestamp>, // dacă status = delivered
  readAt: <timestamp> // dacă status = read
}
```

---

## ✅ **TEST 6: Outbox Restart Safety (Fără Duplicate)**

**Scop:** Dacă backend restartă în timp ce outbox procesează, nu trimite de 2 ori.

**⚠️ Pre-condiție:** Send button implementat.

| Pas | UI Action | API Call | Database Check | Expected |
|-----|-----------|----------|-----------------|----------|
| 6.1 | App → WhatsApp → Chat → Send "Test restart safety" | `POST /api/whatsapp/send-message` | `outbox/{requestId}` → `status = "queued"` | ✅ Outbox doc creat |
| 6.2 | **Imediat după:** Hetzner → Redeploy/restart | - | - | ✅ Service restartat în timp ce outbox procesează |
| 6.3 | Client verifică dacă a primit mesajul | - | - | ✅ Client primește **un singur mesaj** (nu duplicate) |
| 6.4 | Verificare Database (manual) | - | Un singur doc `outbox/{requestId}` pentru aceeași cerere (nu duplicate) | ✅ Nu apare duplicate outbox docs |

**Database Exact Check:**
```javascript
// outbox/{requestId} (UN SINGUR DOC)
{
  requestId: <stabil>, // același requestId
  body: "Test restart safety",
  status: "sent" // sau "delivered"
}

// threads/{threadId}/messages/{waMessageId} (UN SINGUR MESAJ)
{
  body: "Test restart safety",
  direction: "outbound"
}

// ❌ NU există duplicate:
// - outbox/{requestId_duplicate} // NU
// - threads/{threadId}/messages/{messageId_duplicate} // NU
```

---

## ✅ **TEST 7: History Sync / Backfill (Best-effort)**

**Scop:** După pairing, apar mesaje vechi populate în Database.

| Pas | UI Action | API Call | Database Check | Expected |
|-----|-----------|----------|-----------------|----------|
| 7.1 | (Pre-condiție) Cont nou pair-at (cu conversații pe telefon) | - | `accounts/{accountId}` → `status = "connected"` | ✅ Cont connected cu istoric pe telefon |
| 7.2 | Așteaptă 1-5 minute după connected | - | - | ✅ Backend procesează history sync |
| 7.3 | Verificare logs Hetzner | Hetzner → Logs → Căutare `messaging-history.set` | Logs: `[accountId] messaging-history.set received` | ✅ History sync declanșat |
| 7.4 | Verificare Database (manual) | - | `threads/{threadId}/messages` → număr mesaje crește peste cele "noi" | ✅ Mesaje vechi populate |
| 7.5 | (Opțional) Declanșează backfill manual | `POST /api/whatsapp/backfill/:accountId` (dacă există endpoint) | - | ✅ Backfill completat |

**Database Exact Check:**
```javascript
// threads/{threadId}/messages (mai multe docs, inclusiv vechi)
[
  { messageId: "...", body: "...", tsClient: <timestamp vechi>, createdAt: <timestamp vechi> },
  { messageId: "...", body: "...", tsClient: <timestamp nou>, createdAt: <timestamp nou> },
  // ... mai multe mesaje vechi
]

// accounts/{accountId}
{
  lastHistorySyncAt: <timestamp>, // ACTUALIZAT după sync
  lastBackfillAt: <timestamp> // dacă ai rulat backfill
}
```

---

## ✅ **TEST 8: AI Draft Petrecere (Fără Save)**

**Scop:** AI extrage structurat: dată, oră, adresă, personaje, sumă ca "draft".

**⚠️ Pre-condiție:** CRM panel în Chat screen implementat (button "AI: Detectează petrecere (Draft)").

| Pas | UI Action | API Call | Database Check | Expected |
|-----|-----------|----------|-----------------|----------|
| 8.1 | Client scrie în chat: "Vreau pe 10 feb la 18:00, Str. X nr 3, Spiderman + Elsa, buget 1200" | - | `threads/{threadId}/messages/{messageId}` → `body = "Vreau pe 10 feb..."` | ✅ Mesaj inbound salvat |
| 8.2 | App → Chat → CRM Panel → "AI: Detectează petrecere (Draft)" | `POST /api/whatsapp/extract-event-from-thread` (callable `whatsappExtractEventFromThread`, `dryRun=true`) | - | ✅ API răspunde cu draft |
| 8.3 | UI afișează preview (draft) | - | `threads/{threadId}/extractions/{messageId}` → JSON structurat cu `intent`, `event`, `confidence` | ✅ Preview afișat în UI |
| 8.4 | Verificare Database (manual) | - | `threads/{threadId}/extractions/{messageId}` → `action = "CREATE_EVENT"`, `draftEvent` cu `date`, `address`, `payment.amount`, `rolesBySlot` | ✅ Extraction audit salvat |

**Database Exact Check:**
```javascript
// threads/{threadId}/extractions/{messageId}
{
  messageId: <din mesaj>,
  threadId: "...",
  accountId: "WA-01",
  clientJid: "+40712345678@s.whatsapp.net",
  intent: "BOOKING",
  entities: {
    date: "10-02-2026",
    address: "Str. X nr 3",
    payment: { amount: 1200, currency: "RON" },
    characters: ["Spiderman", "Elsa"]
  },
  confidence: 0.85,
  action: "CREATE_EVENT",
  draftEvent: {
    date: "10-02-2026",
    address: "Str. X nr 3",
    phoneE164: "+40712345678",
    payment: { amount: 1200, status: "UNPAID" },
    rolesBySlot: { ... }
  },
  model: "llama-3.1-70b-versatile",
  createdAt: <timestamp>
}

// ❌ NU există încă eveniment în evenimente (dryRun=true)
```

---

## ✅ **TEST 9: Confirm & Save (Creează Eveniment + Istoric)**

**Scop:** Confirmi draft → se creează evenimente, iar la a doua comandă se creează încă unul (nu suprascrie).

| Pas | UI Action | API Call | Database Check | Expected |
|-----|-----------|----------|-----------------|----------|
| 9.1 | (Pre-condiție) Ai draft din Test 8 | - | `threads/{threadId}/extractions/{messageId}` există | ✅ Draft există |
| 9.2 | App → Chat → CRM Panel → "Confirm & Save" | `POST /api/events/create` (sau `chatEventOps` cu `dryRun=false`) | `evenimente/{eventId}` → doc nou cu `date`, `address`, `payment.amount`, `phoneE164` | ✅ Eveniment creat |
| 9.3 | Verificare Database (manual) | - | `evenimente/{eventId}` → `phoneE164 = "+40712345678"`, `payment.amount = 1200`, `date = "10-02-2026"` | ✅ Eveniment salvat cu date corecte |
| 9.4 | Verificare agregare client | - | `clients/{phoneE164}` → `eventsCount = 1`, `lifetimeSpendAll = 1200`, `lastEventAt = <timestamp>` | ✅ Client agregat |
| 9.5 | **Client revine:** scrie "Mai vreau pe 20 martie 17:00, altă adresă, Mickey, 900" | - | `threads/{threadId}/messages/{newMessageId}` → `body = "Mai vreau pe 20 martie..."` | ✅ Mesaj nou salvat |
| 9.6 | App → Chat → CRM Panel → "AI: Detectează petrecere (Draft)" → "Confirm & Save" | `POST /api/whatsapp/extract-event-from-thread` (sau `chatEventOps`) | `evenimente/{eventId2}` → doc **NOU** cu `date = "20-03-2026"`, `payment.amount = 900` | ✅ **AL DOILEA** eveniment creat (nu suprascrie primul) |
| 9.7 | Verificare Database (manual) | - | Query `evenimente` where `phoneE164 = "+40712345678"` → **2 rezultate** (primul cu data 10-02, al doilea cu 20-03) | ✅ Două evenimente separate |

**Database Exact Check:**
```javascript
// evenimente/{eventId1} (PRIMUL)
{
  eventId: "...",
  eventShortId: <număr>,
  phoneE164: "+40712345678",
  date: "10-02-2026",
  address: "Str. X nr 3",
  payment: { amount: 1200, status: "UNPAID", currency: "RON" },
  rolesBySlot: { ... },
  createdAt: <timestamp>
}

// evenimente/{eventId2} (AL DOILEA - SEPARAT)
{
  eventId: "...",
  eventShortId: <număr diferit>,
  phoneE164: "+40712345678", // ACELAȘI CLIENT
  date: "20-03-2026", // DATĂ DIFERITĂ
  address: "altă adresă",
  payment: { amount: 900, status: "UNPAID", currency: "RON" },
  rolesBySlot: { ... },
  createdAt: <timestamp>
}

// clients/{phoneE164}
{
  phoneE164: "+40712345678",
  eventsCount: 2, // ACTUALIZAT
  lifetimeSpendAll: 2100, // 1200 + 900
  lifetimeSpendPaid: 0, // dacă ambele sunt UNPAID
  lastEventAt: <timestamp eventId2>
}
```

---

## ✅ **TEST 10: "Cât A Cheltuit Clientul X?" (Răspuns Exact, Determinist)**

**Scop:** AI răspunde exact pe baza datelor structurate, nu pe ghicit din text.

**⚠️ Pre-condiție:** Client Profile screen implementat (cu button "Ask AI about client").

| Pas | UI Action | API Call | Database Check | Expected |
|-----|-----------|----------|-----------------|----------|
| 10.1 | (Pre-condiție) Ai minim 2 evenimente pentru `phoneE164` (Test 9) | - | `clients/{phoneE164}` → `eventsCount = 2`, `lifetimeSpendAll = 2100` | ✅ Pre-condiție satisfăcută |
| 10.2 | App → Chat → Client Profile (pentru `phoneE164`) | `GET /api/crm/clients/:phoneE164` (sau query direct Database) | `clients/{phoneE164}` → `lifetimeSpendAll`, `eventsCount` | ✅ Client profile încărcat |
| 10.3 | App → Client Profile → "Ask AI about client" → întrebi "Câți bani a cheltuit clientul +40...?" | `POST /api/crm/ask` (callable `clientCrmAsk`, `phoneE164`, `question`) | - | ✅ API răspunde cu answer |
| 10.4 | UI afișează răspuns AI | - | - | ✅ Răspuns afișat în UI |
| 10.5 | Verificare răspuns (manual) | - | Răspunsul include: `total = 2100 RON` (suma exactă din `evenimente.payment.amount`), `breakdown` pe eveniment (date, sumă) | ✅ Răspuns exact bazat pe date structurate |

**Database Exact Check:**
```javascript
// clients/{phoneE164} (AGREGAT - sursa de adevăr)
{
  phoneE164: "+40712345678",
  lifetimeSpendPaid: 0, // dacă ambele sunt UNPAID
  lifetimeSpendAll: 2100, // suma exactă: 1200 + 900
  eventsCount: 2,
  lastEventAt: <timestamp>
}

// evenimente (query where phoneE164 = "+40712345678")
[
  { date: "10-02-2026", payment: { amount: 1200 } },
  { date: "20-03-2026", payment: { amount: 900 } }
]

// AI răspuns (din clientCrmAsk):
{
  answer: "Clientul a cheltuit în total 2100 RON (1200 RON pe 10-02-2026, 900 RON pe 20-03-2026).",
  sources: [
    { eventShortId: 123, date: "10-02-2026", details: "Eveniment 1200 RON" },
    { eventShortId: 124, date: "20-03-2026", details: "Eveniment 900 RON" }
  ]
}

// ❌ NU folosește text din mesaje pentru calcul (doar evenimente.payment.amount)
```

---

## 📋 **Checklist Rapid (Print & Check)**

### **Setup (0.1-0.3)**
- [ ] Hetzner volume montat `/app/sessions`
- [ ] `SESSIONS_PATH=/app/sessions` setat
- [ ] `SUPABASE_SERVICE_ACCOUNT_JSON` setat
- [ ] Database indexes deploy (`supabase deploy --only database:indexes`)
- [ ] Supabase rules: `clients/{phoneE164}` există
- [ ] App login (Supabase Auth)

### **Backend WhatsApp (Test 1-2)**
- [ ] Test 1: Pair account (QR → connected)
- [ ] Test 2: Persistență sesiune (restart fără re-pair)

### **UI WhatsApp (Test 3-6) - ⚠️ Necesită Inbox/Chat implementat**
- [ ] Test 3: Thread isolation (WA-01 vs WA-02)
- [ ] Test 4: Inbound persistence
- [ ] Test 5: Outbound send + receipts
- [ ] Test 6: Outbox restart safety (fără duplicate)

### **CRM + AI (Test 7-10)**
- [ ] Test 7: History sync / backfill
- [ ] Test 8: AI draft petrecere (fără save)
- [ ] Test 9: Confirm & save (2 evenimente separate)
- [ ] Test 10: "Cât a cheltuit?" (răspuns exact, determinist)

---

## 🔍 **Verificări Critice (Pentru "Prod-Ready")**

### **NEVER DELETE Policy:**
- [ ] Database rules: `allow delete: if false` pe `threads`, `messages`, `evenimente`, `clients`
- [ ] UI nu are button "Delete" pentru conversații/evenimente (doar "Archive")

### **Exact Spend Calculation:**
- [ ] `clients/{phoneE164}.lifetimeSpendAll` = `sum(evenimente.payment.amount where phoneE164 = ...)` (calculat din date structurate, nu din text)

### **Idempotency:**
- [ ] Același `clientRequestId` nu creează duplicate în `evenimente`
- [ ] `whatsappExtractEventFromThread` folosește `clientRequestId = sha256(threadId + lastMessageId)`

### **Securitate:**
- [ ] API endpoints cer autentificare (Supabase Auth token)
- [ ] Database rules: `allow write: if false` pe colecții critice (server-only writes)

---

## 📝 **Note pentru Testare**

### **Dacă Inbox/Chat NU sunt implementate încă:**
- Testează doar **Test 1-2** (Accounts) și **Test 7-10** (CRM backend)
- **Test 3-6** necesită Inbox/Chat screens implementate

### **Dacă CRM Panel NU este implementat încă:**
- **Test 8-9** pot fi testate manual prin API calls (curl sau Postman)
- **Test 10** necesită Client Profile screen implementat

### **Dacă Client Profile NU este implementat încă:**
- **Test 10** poate fi testat manual prin API call `clientCrmAsk`

---

## 🚀 **Următorii Pași (După Acceptance)**

1. **Deploy Supabase Functions:**
   ```bash
   supabase deploy --only functions:aggregateClientStats,functions:whatsappExtractEventFromThread,functions:clientCrmAsk
   ```

2. **Deploy Database Rules + Indexes:**
   ```bash
   supabase deploy --only database
   ```

3. **Implement Flutter UI** (dacă lipsește):
   - Inbox/Chat screens (pentru Test 3-6)
   - CRM Panel în Chat screen (pentru Test 8-9)
   - Client Profile screen (pentru Test 10)

4. **Run Acceptance Checklist** (Test 1-10)

---

**END OF ACCEPTANCE CHECKLIST**
