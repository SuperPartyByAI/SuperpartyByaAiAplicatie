# Connecting Timeout Fix - Pairing Phase Preservation

## Problem

**From legacy hosting logs:**
```
⏸️ [account_dev_dde908a65501c63b124cb94c627e551d] Faza de asociere (qr_ready), păstrarea contului (motiv: 515)
💾 [account_dev_dde908a65501c63b124cb94c627e551d] Salvat în Database
🔓 [account_dev_dde908a65501c63b124cb94c627e551d] Blocarea conexiunii a fost deblocată
⏰ [account_dev_dde908a65501c63b124cb94c627e551d] Timp de conectare expirat (60s), trecere la deconectare
```

**Issue**: `connectingTimeout` se declanșează chiar dacă statusul e `qr_ready` după reason 515, și loghează "Timp de conectare expirat, trecere la deconectare" înainte de verificarea finală `isPairingPhaseNow`.

**Root Cause**: Mesajul de log apare la line 1203 înainte de verificarea `isPairingPhaseNow` de la line 1218. Chiar dacă verificarea previne transition-ul corect, mesajul de log este misleading.

## Fix

**File**: `whatsapp-backend/server.js` - `connectingTimeout` handler (lines 1200-1223)

**Change**: Mutat log-ul "Timp de conectare expirat, trecere la deconectare" DUPĂ verificarea `isPairingPhaseNow`, astfel încât logul să apară doar dacă de fapt se face transition la `disconnected`.

**Before**:
```javascript
console.log(`⏰ [${accountId}] Connecting timeout (${timeoutSeconds}s), transitioning to disconnected`);

const currentAcc = connections.get(accountId);
// ... checks ...
if (isPairingPhaseNow) {
  // Skip transition
  return;
}
```

**After**:
```javascript
const currentAcc = connections.get(accountId);
// ... checks ...
if (isPairingPhaseNow) {
  // Skip transition - don't log misleading message
  return;
}

// Only log if we're actually transitioning
console.log(`⏰ [${accountId}] Connecting timeout (${timeoutSeconds}s), transitioning to disconnected`);
```

## Expected Behavior After Fix

**After fix**, când `connectingTimeout` se declanșează și statusul e `qr_ready` după 515:
- ✅ Verifică `isPairingPhaseNow` FIRST (before logging)
- ✅ Skip transition dacă `qr_ready`
- ✅ NU loghează "Trecere la deconectare" (doar "Timeout fired but status is qr_ready (pairing phase), skipping timeout transition")
- ✅ Nu face transition la `disconnected`

## Verification

**Test**: După reason 515, verifică că:
1. ✅ Status rămâne `qr_ready` (nu trece la `disconnected`)
2. ✅ NU există log "Trecere la deconectare" când status e `qr_ready`
3. ✅ Log "Timeout fired but status is qr_ready (pairing phase), skipping timeout transition" apare în loc

## Status

✅ **FIXED** - Log mutat după verificarea `isPairingPhaseNow`
