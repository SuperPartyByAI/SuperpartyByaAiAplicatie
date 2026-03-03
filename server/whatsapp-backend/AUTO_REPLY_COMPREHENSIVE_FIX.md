# Comprehensive Auto-Reply Fix - Implementation Documentation

## Overview

Această documentație descrie implementarea completă a sistemului de auto-reply WhatsApp cu:
- Thread canonicalization pentru eliminarea duplicatelor
- Prompt AI doar în Database (fără hardcode)
- Context AI îmbunătățit cu contact info și metadata
- Name capture logic corect (fără telefon ca nume)
- Logging complet fără emoji cu traceId
- Splitting sigur pentru mesaje lungi (fără propoziții tăiate)
- Fix critic: gate-ul pentru type=append nu mai blochează inbound real

## Problema Root

### Bug Critic: Gate-ul type=append
**Problema**: Mesajele inbound din batch-uri `type=append` erau skip-uite complet, chiar dacă erau fresh și reale. Asta făcea ca name capture și restul logicii să nu ruleze.

**Soluția**: Gate-ul pentru `type !== 'notify'` a fost mutat din `handleMessagesUpsert` în `maybeHandleAiAutoReply`, unde se verifică age window per mesaj individual. Astfel, mesajele inbound reale din append batch vor fi procesate dacă sunt fresh (în window-ul de 2 minute).

### Thread Duplicate Issue
**Problema**: Același contact putea avea multiple thread-uri din cauza:
- Format diferit de telefon (+40 vs 40)
- JID diferit (@lid vs @s.whatsapp.net)
- ThreadId construit direct din remoteJid fără canonicalizare

**Soluția**: 
- Canonicalizare bazată pe phoneDigits pentru 1:1 contacts
- Fallback anti-duplicate care caută thread-uri existente după telefon
- Toate scrierile folosesc `actualThreadId` (canonical sau găsit prin fallback)

## Modificări Implementate

### A) Thread Canonicalization + Anti-Duplicate

#### Funcții noi/modificate:

1. **`normalizePhone(input)`** (linia ~123)
   - Păstrează doar cifrele (fără +, spații, paranteze)
   - Returnează `null` dacă input este invalid
   - Exemplu: "+40 768 098 268" -> "40768098268"

2. **`isLidJid(jid)`** (linia ~135)
   - Detectează JID-uri de tip @lid

3. **`isUserJid(jid)`** (linia ~142)
   - Detectează JID-uri de tip @s.whatsapp.net

4. **`canonicalClientKey(remoteJid, accountId)`** (linia ~150)
   - Pentru `@s.whatsapp.net`: extrage digits și returnează `${digits}@s.whatsapp.net`
   - Pentru `@lid`: încearcă să rezolve phone din mapping file
   - Pentru grupuri: returnează JID-ul original
   - Returnează: `{canonicalKey, phoneDigits, phoneE164}`

5. **`buildCanonicalThreadId(accountId, canonicalKey, phoneDigits)`** (linia ~200)
   - **IMPORTANT**: Pentru 1:1 contacts cu phoneDigits, folosește format: `${accountId}__${phoneDigits}@s.whatsapp.net`
   - Asta asigură că același telefon = același threadId indiferent de JID type
   - Pentru grupuri sau @lid fără phone, folosește canonicalKey

6. **`findExistingThreadByPhone(accountId, phoneDigits, phoneE164)`** (linia ~212)
   - Caută thread-uri existente după `phoneE164` sau `phone`
   - Alege thread-ul cu cea mai recentă activitate (`autoReplyLastClientReplyAt` sau `updatedAt` sau `createdAt`)
   - Returnează `{threadId, threadData}` sau `{null, null}`

#### Logic în `maybeHandleAiAutoReply`:

- La început: calculează `canonicalKey`, `phoneDigits`, `phoneE164` și `canonicalThreadId`
- Dacă `threadDoc.exists=false` și avem `phoneDigits`:
  - Apelează `findExistingThreadByPhone` pentru a găsi thread existent
  - Dacă găsește, folosește `actualThreadId` = thread-ul găsit
  - Loghează `pickedExistingThread=true`
- Toate scrierile în Database folosesc `actualThreadId` (nu `threadId` vechi)

### B) Prompt AI doar în Database (fără hardcode)

#### Prioritatea promptului:

1. `threads/{actualThreadId}.aiSystemPrompt` (override per contact)
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
[AutoReply][Trace] traceId=... accountId=... remoteJid=... participant=... jidType=lid|user|group isGroup=... fromMe=... eventType=... messageAgeSec=... phoneDigits=... phoneE164=... canonicalKey=... canonicalThreadId=... computedThreadId=...
```

#### Loguri după Database read:

```
[AutoReply][Trace] traceId=... threadDocExists=true|false pickedExistingThreadId=...
[AutoReply][Trace] traceId=... threadDataLoaded actualThreadId=... exists=... pickedExisting=... hasFirstName=... hasDisplayName=... hasPendingNameRequest=... hasPendingPreferredName=...
```

#### Loguri pentru name capture:

```
[AutoReply][Name] traceId=... hasFirstName=... pendingNameRequest=... pendingPreferredName=... nameSource=... action=willAsk|awaitingName|awaitingPreferred|hasName|savedName|askedPreferred|savedPreferred
```

#### Loguri pentru prompt:

```
[AutoReply][Prompt] traceId=... promptSource=thread|account|env promptLength=... promptHash=... nameSource=firstName|displayName|fallback
```

#### Loguri pentru AI:

```
[AutoReply][AI] traceId=... called=true model=llama-3.3-70b-versatile maxTokens=... historyLength=... promptLength=...
```

#### Loguri pentru send:

```
[AutoReply][Send] traceId=... sendingReply accountId=... clientJid=... totalChars=... chunks=...
```

### F) Splitting Sigur pentru Mesaje Lungi

#### Funcție `splitMessageSafely(text, maxChars)`:

- Definește `WA_MAX_CHARS` din env (default: 3000)
- Dacă text > WA_MAX_CHARS:
  1. Încearcă să taie la ultima delimitare de paragraf (`\n\n`)
  2. Dacă nu găsește, taie la ultima delimitare de propoziție (`. `, `! `, `? `, `\n`)
  3. Dacă nu găsește, taie la ultimul spațiu
  4. Nu rupe în mijlocul cuvintelor dacă se poate evita
- Trimite bucățile secvențial cu delay mic între ele (100ms)
- Loghează: `chunks count` și `totalChars`

#### Validare mesaj:

- Verifică dacă se termină cu propoziție completă (`.`, `!`, `?`)
- Verifică dacă este între `AI_REPLY_MIN_CHARS` (50) și `AI_REPLY_MAX_CHARS` (200)
- Dacă nu este valid, skip (nu trimite)

#### max_tokens pentru AI:

- `AI_MAX_TOKENS` din env (default: 500)
- Loghează `finishReason` - dacă e `length`, înseamnă că mesajul a fost trunchiat de model
- În acest caz, loghează warning

### G) Ordinea Gates

Ordinea exactă a gate-urilor în `maybeHandleAiAutoReply`:

1. Validare input (msg, saved)
2. **fromMe check** (skip outbound)
3. **Group check** (skip grupuri)
4. **Invalid JID check**
5. **Age window check** (doar mesaje fresh în ultimele 2 minute) - **CRITICAL FIX**: nu mai blocăm pe eventType
6. **Dedupe check** (idempotency)
7. **Text message check** (doar conversation/extendedText)
8. **Database available check**
9. **Load thread data + fallback anti-duplicate**
10. **Settings check** (auto-reply enabled)
11. **Name capture gates** (înainte de AI):
    - Dacă nu are nume și nu e pending: întreabă numele → RETURN
    - Dacă e pendingPreferredName: procesează răspuns → RETURN
    - Dacă e pendingNameRequest: procesează răspuns → RETURN
12. **Command check** (stop/dezactiveaza)
13. **Cooldown checks** (thread + clientJid)
14. **GROQ_API_KEY check**
15. **Build context + prompt**
16. **Call AI**
17. **Validate reply** (complet, între min/max)
18. **Split message** (dacă e prea lung)
19. **Send reply** (chunks secvențial)
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
journalctl -u whatsapp-backend -f | grep -E '\[AutoReply\]'
```

**Loguri așteptate:**
```
[AutoReply][Trace] traceId=... jidType=user phoneDigits=... canonicalThreadId=...
[AutoReply][Trace] traceId=... threadDocExists=false pickedExistingThreadId=null
[AutoReply][Name] traceId=... hasFirstName=false action=willAsk
[AutoReply][Name] traceId=... action=askedName threadId=...
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
[AutoReply][Name] traceId=... action=awaitingName
[AutoReply][Name] traceId=... action=savedName firstName=Ion fullName=Ion Popescu
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
[AutoReply][Name] traceId=... action=savedName firstName=Andrei fullName=Ursache Andrei
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
[AutoReply][Name] traceId=... action=askedPreferred fullName=Ion Gigi Matei Popescu
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
[AutoReply][Name] traceId=... action=savedPreferred preferredName=Gigi
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
[AutoReply][Trace] traceId=... canonicalKey=40768098268@s.whatsapp.net phoneDigits=40768098268 canonicalThreadId=account_xxx__40768098268@s.whatsapp.net
[AutoReply][Trace] traceId=... threadDocExists=false willCreateNew

# Al doilea mesaj (același contact, format diferit)
[AutoReply][Trace] traceId=... canonicalKey=40768098268@s.whatsapp.net phoneDigits=40768098268 canonicalThreadId=account_xxx__40768098268@s.whatsapp.net
[AutoReply][Trace] traceId=... pickedExistingThreadId=account_xxx__40768098268@s.whatsapp.net
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
[AutoReply][Trace] traceId=... jidType=lid canonicalKey=40768098268@s.whatsapp.net phoneDigits=40768098268 phoneE164=+40768098268
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
[AutoReply][Prompt] traceId=... promptSource=account|thread|env promptLength=... promptHash=... nameSource=firstName|displayName|fallback
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
[AutoReply][Trace] traceId=... pickedExistingThreadId=account_xxx__old_thread_id
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
[AutoReply][AI] traceId=... called=true model=llama-3.3-70b-versatile maxTokens=500 historyLength=... promptLength=...
[AutoReply][Validate] Message complete and valid: ... chars (ends with sentence)
[AutoReply][Send] traceId=... sendingReply totalChars=... chunks=1
```

**Verificare:**
- Răspunsul se termină cu `.`, `!` sau `?`
- Răspunsul este între `AI_REPLY_MIN_CHARS` (50) și `AI_REPLY_MAX_CHARS` (200)
- Nu este trunchiat

### Test 11: Mesaj lung cu splitting

**Pași:**
1. Trimite mesaj inbound care generează răspuns lung (>3000 caractere)
2. Verifică că mesajul este split-uit corect

**Loguri așteptate:**
```
[AutoReply][Send] traceId=... sendingReply totalChars=3500 chunks=2
```

**Verificare:**
- Mesajul este split-uit în chunks
- Fiecare chunk se termină cu propoziție completă sau paragraf
- Chunks sunt trimise secvențial

### Test 12: Fix gate-ul type=append

**Pași:**
1. Simulează un mesaj inbound fresh în batch type=append
2. Verifică că mesajul este procesat (nu skip-uit)

**Loguri așteptate:**
```
[AutoReply][Trace] traceId=... eventType=append ageSec=30 processing_fresh_inbound
[AutoReply][Trace] traceId=... allGatesPassed generatingReply
```

**Verificare:**
- Mesajul nu este skip-uit doar pentru că eventType=append
- Age window check permite procesarea dacă mesajul este fresh

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
journalctl -u whatsapp-backend --since '10 minutes ago' | grep -E '\[Name\]|action='
```

### Verificare prompt source:
```bash
journalctl -u whatsapp-backend --since '10 minutes ago' | grep -E 'promptSource|promptHash|autoSetSecurityPrompt'
```

### Verificare splitting:
```bash
journalctl -u whatsapp-backend --since '10 minutes ago' | grep -E 'chunks=|totalChars='
```

### Verificare fix type=append:
```bash
journalctl -u whatsapp-backend --since '10 minutes ago' | grep -E 'eventType=append|processing_fresh_inbound'
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

## Environment Variables

### Variabile necesare:

- `GROQ_API_KEY` - Cheia API pentru Groq (obligatoriu)
- `AI_DEFAULT_SYSTEM_PROMPT` - Fallback prompt dacă nu există în Database (opțional, dar recomandat)
- `AI_SECURITY_PROMPT_TEMPLATE` - Template pentru auto-set prompt în Database (opțional)
- `AI_CONTEXT_MESSAGE_LIMIT` - Număr mesaje în context (default: 50)
- `AI_REPLY_MIN_CHARS` - Min caractere pentru răspuns (default: 50)
- `AI_REPLY_MAX_CHARS` - Max caractere pentru răspuns (default: 200)
- `AI_REPLY_COOLDOWN_MS` - Cooldown între răspunsuri (default: 10000ms = 10s)
- `AI_MAX_TOKENS` - Max tokens pentru AI (default: 500)
- `WA_MAX_CHARS` - Max caractere per mesaj WhatsApp (default: 3000)

## Exemple de Loguri Complete

### Exemplu 1: Contact nou, name request
```
[AutoReply][Trace] traceId=ABC123 accountId=hash:8 remoteJid=hash:15 jidType=user isGroup=false fromMe=false eventType=notify messageAgeSec=5 phoneDigits=40768098268 phoneE164=+40768098268 canonicalKey=40768098268@s.whatsapp.net canonicalThreadId=hash:50 computedThreadId=hash:50
[AutoReply][Trace] traceId=ABC123 threadDocExists=false pickedExistingThreadId=null
[AutoReply][Trace] traceId=ABC123 threadDataLoaded actualThreadId=hash:50 exists=false pickedExisting=false hasFirstName=false
[AutoReply][Name] traceId=ABC123 hasFirstName=false pendingNameRequest=false pendingPreferredName=false nameSource=fallback action=willAsk
[AutoReply][Name] traceId=ABC123 action=askedName threadId=hash:50 phoneDigits=40768098268
```

### Exemplu 2: Răspuns cu nume, apoi AI reply
```
[AutoReply][Trace] traceId=DEF456 accountId=hash:8 remoteJid=hash:15 jidType=user phoneDigits=40768098268 canonicalThreadId=hash:50
[AutoReply][Trace] traceId=DEF456 threadDocExists=true pickedExistingThreadId=null
[AutoReply][Trace] traceId=DEF456 threadDataLoaded actualThreadId=hash:50 exists=true pickedExisting=false hasFirstName=true
[AutoReply][Name] traceId=DEF456 hasFirstName=true pendingNameRequest=false nameSource=firstName action=hasName
[AutoReply][Trace] traceId=DEF456 allGatesPassed generatingReply actualThreadId=hash:50
[AutoReply][Prompt] traceId=DEF456 promptSource=account promptLength=1234 promptHash=a1b2c3d4 nameSource=firstName
[AutoReply][AI] traceId=DEF456 called=true model=llama-3.3-70b-versatile maxTokens=500 historyLength=5 promptLength=1500
[AutoReply][Validate] Message complete and valid: 120 chars (ends with sentence)
[AutoReply][Send] traceId=DEF456 sendingReply accountId=hash:8 clientJid=hash:15 totalChars=120 chunks=1
[AutoReply][Trace] traceId=DEF456 success accountId=hash:8 actualThreadId=hash:50 jid=@s.whatsapp.net msg=hash:12 replyLen=120 chunks=1 aiLatency=500ms totalLatency=800ms pickedExistingThread=false
```

### Exemplu 3: Picked existing thread (anti-duplicate)
```
[AutoReply][Trace] traceId=GHI789 accountId=hash:8 remoteJid=hash:15 jidType=user phoneDigits=40768098268 canonicalThreadId=hash:50
[AutoReply][Trace] traceId=GHI789 threadDocMissing attemptingFallback phoneDigits=40768098268 phoneE164=+40768098268
[AutoReply][Trace] traceId=GHI789 pickedExistingThreadId=hash:50
[AutoReply][Trace] traceId=GHI789 threadDataLoaded actualThreadId=hash:50 exists=true pickedExisting=true hasFirstName=true
```

### Exemplu 4: Mesaj lung cu splitting
```
[AutoReply][AI] traceId=JKL012 called=true model=llama-3.3-70b-versatile maxTokens=500
[AutoReply][Validate] Message complete and valid: 3500 chars (ends with sentence)
[AutoReply][Send] traceId=JKL012 sendingReply totalChars=3500 chunks=2
[AutoReply][Trace] traceId=JKL012 success replyLen=3500 chunks=2
```

### Exemplu 5: Fix type=append
```
[AutoReply][Trace] traceId=MNO345 eventType=append ageSec=30 processing_fresh_inbound
[AutoReply][Trace] traceId=MNO345 allGatesPassed generatingReply
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

### Problemă: Mesajele din append batch nu sunt procesate

**Verificare:**
1. Verifică logurile pentru `eventType=append` și `processing_fresh_inbound`
2. Verifică că age window check permite procesarea (mesajul trebuie să fie în ultimele 2 minute)
3. Verifică că gate-ul nu mai blochează pe eventType în `handleMessagesUpsert`

## Concluzie

Toate cerințele au fost implementate:
- ✅ Thread canonicalization cu anti-duplicate fallback
- ✅ Prompt doar în Database (fără hardcode, cu auto-set)
- ✅ Context AI îmbunătățit cu contact info și metadata
- ✅ Name capture logic complet cu gestionare nume multiple
- ✅ Logging complet fără emoji cu traceId
- ✅ Splitting sigur pentru mesaje lungi (fără propoziții tăiate)
- ✅ Fix critic: gate-ul pentru type=append nu mai blochează inbound real
- ✅ Toate thread writes folosesc `actualThreadId` și salvează phone fields

Sistemul este gata pentru testare și deployment.
