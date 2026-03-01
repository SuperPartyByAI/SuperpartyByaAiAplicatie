# Fix regenerateQr 500 Loop + Account Disappearing

## Probleme Identificate din Logs

### Problema 1: regenerateQr 500 Loop
**Din logs Flutter:**
```
[WhatsAppApiService] regenerateQr: status=200 (prima apelare - OK)
[WhatsAppApiService] regenerateQr: status=500 (următoarele 15+ apelări - FAIL)
```

**Cauza:** 
- Prima regenerare reușește (200), dar conexiunea se închide imediat după QR generation
- Următoarele apelări găsesc account-ul în `connecting` dar conexiunea este deja închisă
- Backend returnează 500 în loc de 202 "already_in_progress"

### Problema 2: Account Disappearing
**Din logs Flutter:**
```
[WhatsAppApiService] getAccounts: accountsCount=1 (după addAccount)
[WhatsAppApiService] regenerateQr: status=200 (OK)
[WhatsAppApiService] getAccounts: accountsCount=0 (după regenerateQr - ACCOUNT DISPARE!)
```

**Cauza:**
- După QR generation, conexiunea se închide cu "unknown" reason
- Timeout de 60s marchează account-ul ca `disconnected`
- Account-ul este marcat ca `disconnected` în Database
- GET /accounts include accounts cu status `disconnected`, dar UI-ul poate să nu-l afișeze

### Problema 3: Connection Closes After QR
**Din legacy hosting logs:**
```
🔔 [account_xxx] Connection update: qr
📱 [account_xxx] QR Code generated
💾 [account_xxx] Saved to Database
🔔 [account_xxx] Connection update: close
🔌 [account_xxx] Reason code: unknown
⏰ [account_xxx] Connecting timeout (60s), transitioning to disconnected
```

**Cauza:**
- După QR generation, conexiunea se închide imediat cu "unknown" reason
- Probabil din cauza unui error în Baileys sau Database backup
- Timeout de 60s marchează account-ul ca `disconnected`

---

## Fix-uri Aplicate

### Fix 1: regenerateQr Idempotency (Backend)
**File:** `whatsapp-backend/server.js:3685-3696`

**Problema:** Verifica doar în memorie dacă `regeneratingQr` este true, dar după disconnect account-ul nu mai este în memorie.

**Fix:**
- Verifică și în Database dacă `regeneratingQr` este true
- Returnează 202 "already_in_progress" dacă găsește flag-ul în Database

```javascript
// IDEMPOTENCY: Check if regenerate is already in progress
// Check both in-memory and Database for regenerating flag
let isRegenerating = false;
if (account && connections.has(accountId)) {
  isRegenerating = account.regeneratingQr === true || account.status === 'connecting';
} else if (databaseAvailable && db) {
  // Check Database if not in memory
  try {
    const accountDoc = await db.collection('accounts').doc(accountId).get();
    if (accountDoc.exists) {
      const data = accountDoc.data();
      isRegenerating = data.regeneratingQr === true || data.status === 'connecting';
    }
  } catch (error) {
    console.error(`⚠️  [${accountId}/${requestId}] Failed to check regenerating flag in Database:`, error.message);
  }
}

if (isRegenerating) {
  return res.status(202).json({ 
    success: true, 
    message: 'QR regeneration already in progress',
    status: 'already_in_progress',
    accountId: accountId,
    requestId: requestId,
  });
}
```

### Fix 2: Client Guard - Treat 202 as Success
**File:** `superparty_flutter/lib/services/whatsapp_api_service.dart:340-354`

**Problema:** Client-ul trata 202 ca error și seta cooldown, cauzând buclă.

**Fix:**
- Tratează 202 "already_in_progress" ca success
- Nu setează cooldown pentru 202
- Returnează success response pentru 202

```dart
if (response.statusCode < 200 || response.statusCode >= 300) {
  final errorBody = jsonDecode(response.body) as Map<String, dynamic>?;
  final status = errorBody?['status'] as String?;
  
  // Set cooldown on failure (except for 202 "already in progress" which is OK)
  if (response.statusCode != 202 && status != 'already_in_progress') {
    _regenerateCooldown[accountId] = DateTime.now();
  } else {
    // 202 is OK - don't set cooldown, don't throw error
    return {
      'success': true,
      'message': errorBody?['message'] ?? 'QR regeneration already in progress',
      'status': 'already_in_progress',
      'requestId': errorBody?['requestId'],
    };
  }
  
  throw ErrorMapper.fromHttpException(...);
}
```

### Fix 3: Preserve Account During Pairing Phase
**File:** `whatsapp-backend/server.js:1463-1505`

**Status:** ✅ Deja implementat

**Comportament:**
- Pentru reason "unknown" în pairing phase, păstrează account-ul
- Marchează status ca `awaiting_scan` sau `qr_ready` (nu `disconnected`)
- Păstrează QR code în Database dacă există

---

## Teste

### Test 1: regenerateQr nu mai dă 500 Loop
```bash
# 1. Add account → QR apare
# 2. Tap "Regenerate QR" de 3-4 ori rapid
# Expected: Prima apelare: 200 OK
# Expected: Următoarele: 202 "already in progress" (nu 500)
# Expected: Nu mai apare buclă de 500 errors
```

### Test 2: Account nu mai dispare
```bash
# 1. Add account → QR apare
# 2. Regenerate QR → QR se regenerează
# 3. Așteaptă 2-3 secunde
# 4. getAccounts → accountsCount=1 (nu 0)
# Expected: Account rămâne vizibil chiar dacă conexiunea se închide
```

### Test 3: Connection Close Handling
```bash
# 1. Add account → QR apare
# 2. Verifică legacy hosting logs:
# Expected: După QR generation, dacă conexiunea se închide:
#   - Account status: awaiting_scan sau qr_ready (nu disconnected)
#   - QR code păstrat în Database
#   - Account vizibil în GET /accounts
```

---

## Logs Expected

### Backend (legacy hosting)
```
🔍 [req_xxx] Regenerate QR request: accountId=account_xxx
🔍 [req_xxx] Account state: status=connecting, waMode=active
ℹ️  [account_xxx/req_xxx] Regenerate already in progress (status=connecting), returning 202 Accepted
```

### Client (Flutter)
```
[WhatsAppApiService] regenerateQr: status=202
[WhatsAppApiService] regenerateQr: 202 already_in_progress - returning success
[WhatsAppAccountsScreen] _regenerateQr: response received (success=true, status=already_in_progress)
```

---

## Next Steps

1. **Deploy fixes** la legacy hosting backend
2. **Deploy fixes** la Flutter client
3. **Test manual** - Verifică că regenerateQr nu mai dă 500 loop
4. **Test manual** - Verifică că account nu mai dispare după regenerateQr

---

## Root Cause Summary

1. **regenerateQr 500 loop:** Backend nu verifica Database pentru `regeneratingQr` flag → returnează 500 în loc de 202
2. **Client guard:** Client trata 202 ca error → seta cooldown → buclă
3. **Account disappearing:** Connection closes după QR → timeout → status `disconnected` → UI nu-l afișează (deși GET /accounts îl include)

**Fix:** 
- Backend verifică Database pentru `regeneratingQr` flag
- Client tratează 202 ca success
- Account păstrat în pairing phase (deja implementat)
