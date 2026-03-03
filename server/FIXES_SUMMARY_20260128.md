# 📋 Sumar Fix-uri - 28 Ianuarie 2026

## 🎯 Probleme Rezolvate

### 1. ✅ Contract Eroare Autentificare (Backend)

**Problema:** Testele CI așteptau `error: "missing_auth_token"` dar codul returna `error: "unauthorized"` pentru missing token.

**Fix Aplicat:**
- `whatsapp-backend/server.js:2481` - `requireSupabaseAuth` returnează acum `missing_auth_token` pentru missing token
- `functions/whatsappProxy.js:151` - `requireAuth` returnează `missing_auth_token` pentru missing token
- `unauthorized` rămâne pentru token invalid/expired (corect)

**Fișiere Modificate:**
- `whatsapp-backend/server.js`
- `functions/whatsappProxy.js`

**Status:** ✅ Testele CI vor trece

---

### 2. ✅ ThreadModel.initial - Parsing Numere Telefon (Flutter)

**Problema:** Testul aștepta `initial: '4'` dar primea `'+'` când phone era `'+40711111111'`.

**Fix Aplicat:**
- `superparty_flutter/lib/models/thread_model.dart:211-217` - Extrage prima cifră din phone (normalizează la cifre cu `replaceAll(RegExp(r'\D'), '')`)
- Fallback la displayName dacă phone e null

**Fișiere Modificate:**
- `superparty_flutter/lib/models/thread_model.dart`

**Status:** ✅ Testul Flutter va trece

---

### 3. ✅ Auto-Backfill pentru Employee Inbox

**Problema:** Mesajele vechi nu se sincronizau automat la prima deschidere a inbox-ului pentru angajați.

**Fix Aplicat:**
- Adăugat `_hasRunAutoBackfill` flag (rulează o dată per sesiune)
- Adăugat `_runAutoBackfillForAccounts()` care:
  - Verifică autentificare
  - Filtrează doar conturi conectate din lista angajaților
  - Rulează backfill fire-and-forget (non-blocking)
  - Gestionează erorile silențios cu debug logging

**Fișiere Modificate:**
- `superparty_flutter/lib/screens/whatsapp/employee_inbox_screen.dart`

**Status:** ✅ Implementat și gata de testare

---

### 4. ✅ Database Query Fix (Employee Inbox)

**Problema:** Query-ul Database folosea `orderBy('lastMessageAt')` cu `where('accountId')`, necesitând index compus care lipsea, cauzând erori.

**Fix Aplicat:**
- Eliminat `orderBy` din query Database
- Implementat sortare în memorie în `_rebuildThreads()` cu `_threadTimeMs()` helper
- Sortare stabilă cu tie-breaker pe threadId

**Fișiere Modificate:**
- `superparty_flutter/lib/screens/whatsapp/employee_inbox_screen.dart`

**Status:** ✅ Nu mai necesită index compus Database

---

### 5. ✅ Eroare 500 - Memory OOM (Cloud Functions)

**Problema:** 
- `whatsappProxySend` și `whatsappProxyGetAccountsStaff` foloseau 129-139 MiB dar limita era 128 MiB
- Rezultat: OOM → funcția moare → Cloud Run returnează HTML 500 în loc de JSON

**Fix Aplicat:**
- `functions/whatsappProxy.js:593` - `exports.send` acum are `memory: '256MiB'`
- `functions/index.js:968` - `proxyOpts` actualizat la `memory: '256MiB'` (folosit de toate funcțiile proxy)

**Fișiere Modificate:**
- `functions/whatsappProxy.js`
- `functions/index.js`

**Deploy Status:** ✅ Deploy completat - ambele funcții rulează cu 256 MiB

**Verificare:**
```bash
supabase functions:list | grep -E "whatsappProxyGetAccountsStaff|whatsappProxySend"
# Ar trebui să vezi: 256 (nu 128)
```

---

## 📊 Statistici Modificări

```
6 files changed, 184 insertions(+), 14 deletions(-)

functions/index.js                                 |   3 +-
functions/whatsappProxy.js                         |   1 +
superparty_flutter/lib/models/thread_model.dart    |   8 +-
superparty_flutter/lib/screens/whatsapp/employee_inbox_screen.dart | 151 +++++++++++++++++++--
whatsapp-backend/server.js                         |   2 +-
FIX_REVIEW_COMPLETE.md (nou)                      |   documentație
```

---

## ✅ Checklist Final

- [x] Contract eroare autentificare aliniat cu testele CI
- [x] ThreadModel.initial extrage prima cifră corect
- [x] Auto-backfill implementat pentru employee inbox
- [x] Database query fix (nu mai necesită index compus)
- [x] Memory OOM fix pentru `whatsappProxySend` (256MiB)
- [x] Memory OOM fix pentru `whatsappProxyGetAccountsStaff` (256MiB)
- [x] Deploy completat pentru ambele funcții

---

## 🧪 Testare Necesară

### Backend Tests (CI)
- [ ] Rulează `npm test` în `functions/` - ar trebui să treacă testele pentru `missing_auth_token`

### Flutter Tests
- [ ] Rulează `flutter test` - testul `ThreadModel.initial` ar trebui să treacă

### Test Manual - Employee Inbox
1. Deschide aplicația pe iOS
2. Navighează la: WhatsApp → Employee Inbox
3. Verifică:
   - [ ] Se încarcă conversațiile (fără eroare Database)
   - [ ] Auto-backfill pornește (caută log-uri `[EmployeeInboxScreen] Auto-backfill started`)
   - [ ] Nu apare eroarea 500

### Test Manual - Send Message
1. Deschide un chat
2. Trimite un mesaj
3. Verifică:
   - [ ] Mesajul se trimite fără eroarea 500
   - [ ] Apare confirmare de succes

---

## 📝 Note Tehnice

### Memory Configuration
- Toate funcțiile proxy folosesc `proxyOpts` din `functions/index.js`
- `whatsappProxySend` are și configurație explicită în `functions/whatsappProxy.js` (pentru siguranță)
- Limita: 256 MiB (suficient pentru 130-139 MiB usage actual)

### Database Indexes
- Employee inbox nu mai necesită index compus `(accountId, lastMessageAt)`
- Sortarea se face în memorie după ce datele sunt primite

### Auto-Backfill Logic
- Rulează o singură dată per sesiune (`_hasRunAutoBackfill` flag)
- Fire-and-forget (non-blocking) - nu blochează UI
- Doar pentru conturi conectate din lista angajaților
- Silent fail cu debug logging

---

## 🔗 Referințe

- Documentație completă: `FIX_REVIEW_COMPLETE.md`
- Teste CI: `functions/test/whatsappProxy.test.js`
- Teste Flutter: `superparty_flutter/test/models/thread_model_test.dart`

---

**Data:** 28 Ianuarie 2026  
**Branch:** `fix/whatsapp-improvements-20260127`  
**Status:** ✅ Toate fix-urile aplicate și deploy-ate
