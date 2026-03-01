# Production Hardening - DEPLOYMENT STATUS

**Date:** 2026-01-18  
**Branch:** `audit-whatsapp-30`  
**Commit:** `336e4e18` (hardening changes) + follow-up commits

---

## ✅ Code Changes Complete

All hardening changes have been successfully implemented and committed:

### 1. CPU Quota Reduction (~88% reduction)

**Global:** `setGlobalOptions` maxInstances: `10` → `2`

**Functions with maxInstances: 1:**
- CRM AI (3): `whatsappExtractEventFromThread`, `clientCrmAsk`, `aggregateClientStats`
- Proxy handlers (6): All `whatsappProxy*` functions  
- Old AI (10): `archiveEventAI`, `getEventeAI`, `updateEventAI`, `noteazaEventeAutomat`, `manageRoleAI`, `manageEvidenceAI`, `generateReportAI`, `createEventFromAI`, `aiEventHandler`, `chatWithAI`

**Other:** `whatsappV4` maxInstances: `10` → `2`

### 2. Dist Warnings Silenced

- Added `fs.existsSync()` check before requiring `./dist/index.js`
- Warnings only log if `NODE_ENV !== 'production'` or `DEBUG_DIST_LOAD=true`
- Production logs will be clean

### 3. CORS Verified

- All `whatsappProxy*` functions use `cors: true` (built-in v2)
- No changes needed

---

## ⚠️ Deployment Blocked - Manual Step Required

### Problem

Supabase CLI does not allow automatic upgrade from **1st Gen (v1)** to **2nd Gen (v2)** functions.

The old `whatsapp(us-central1)` function (v1) must be **manually deleted** before deployment can proceed.

### Error Message

```
Error: [whatsapp(us-central1)] Upgrading from 1st Gen to 2nd Gen is not yet supported. 
See https://supabase.google.com/docs/functions/2nd-gen-upgrade before migrating to 2nd Gen.
```

---

## 🔧 Manual Step to Complete Deployment

### Option 1: Supabase Console (Recommended)

1. Go to: https://console.supabase.google.com/
2. Select project: **superparty-frontend**
3. Navigate to: **Functions** (left sidebar)
4. Find function: **whatsapp** (us-central1, Node.js 20, **1st Gen**)
5. Click **3 dots menu** → **Delete**
6. Confirm deletion

### Option 2: Google Cloud Console

1. Go to: https://console.cloud.google.com/
2. Select project: **superparty-frontend**
3. Navigate to: **Cloud Functions** → **1st gen** tab
4. Find: **whatsapp** (us-central1)
5. Select checkbox → **DELETE**

---

## 🌍 EU Region Migration (APPLIED)

**Status:** ✅ **COMPLETE**

**Functions moved to europe-west1:**
- `aggregateClientStats` (Database trigger)
- `whatsappExtractEventFromThread` (AI callable)
- `clientCrmAsk` (AI callable)

**Flutter updated:**
- `extractEventFromThread()` → calls `europe-west1`
- `askClientAI()` → calls `europe-west1`

**Deployment command (after manual deletion):**
```bash
# Deploy only migrated functions
supabase deploy --only functions:aggregateClientStats,functions:whatsappExtractEventFromThread,functions:clientCrmAsk

# Then deploy all other functions
supabase deploy --only functions
```

**Post-migration verification:**
```bash
# Verify regions changed
supabase functions:list | grep -E "aggregateClientStats|whatsappExtractEventFromThread|clientCrmAsk"
# Expected: Region should show europe-west1 for these 3

# Test callable from Flutter
# extractEventFromThread and askClientAI should work without errors
```

---

## 🚀 After Manual Deletion

Run deployment command:

```bash
cd /Users/universparty/Aplicatie-SuperpartyByAi
supabase deploy --only functions
```

**Expected result:**
- No v1→v2 upgrade conflict
- All functions deploy successfully
- CPU quota errors eliminated
- Dist warnings silenced

---

## 📊 Files Modified (14 total)

1. `functions/index.js` - Global maxInstances, dist warnings, chatWithAI, whatsappV4
2. `functions/whatsappExtractEventFromThread.js` - maxInstances: 1
3. `functions/clientCrmAsk.js` - maxInstances: 1
4. `functions/aggregateClientStats.js` - maxInstances: 1
5. `functions/whatsappProxy.js` - maxInstances: 1 (6 functions)
6-14. Old AI functions (9 files) - maxInstances: 1 each

---

## 📝 Documentation Added

- `PRODUCTION_HARDENING_SUMMARY.md` - Complete summary of changes
- `MANUAL_STEP_DELETE_OLD_WHATSAPP.md` - Step-by-step deletion instructions

---

## ✅ Verification Commands (After Deployment)

```bash
# List all deployed functions (verify whatsappV4 exists, old whatsapp is gone)
supabase functions:list | grep -E "whatsapp|clientCrmAsk|aggregateClientStats"

# Expected output:
# ✓ whatsappV4 (v2, us-central1)
# ✓ whatsappExtractEventFromThread (v2, us-central1)
# ✓ clientCrmAsk (v2, us-central1)
# ✓ aggregateClientStats (v2, us-central1)
# ✓ whatsappProxy* functions (v2, us-central1)
# ✗ whatsapp (should NOT appear - if it does, deletion failed)

# View logs (correct syntax with --lines, NOT --limit)
supabase functions:log --only clientCrmAsk --lines 200
supabase functions:log --only whatsappExtractEventFromThread --lines 200
supabase functions:log --only aggregateClientStats --lines 200
supabase functions:log --only whatsappProxySend --lines 100
supabase functions:log --only whatsappV4 --lines 100

# Check for CPU quota errors (should see none after hardening)
supabase functions:log --only whatsappV4 --lines 50 | grep -i "quota"

# Verify maxInstances applied correctly (should see low numbers)
supabase functions:list | grep -A 2 "clientCrmAsk"
# Look for: Memory: 512, Max instances: 1
```

---

## Status Summary

| Task | Status |
|------|--------|
| Code changes (maxInstances) | ✅ Complete |
| Code changes (dist warnings) | ✅ Complete |
| CORS verification | ✅ Complete |
| Git commit & push | ✅ Complete |
| **Manual deletion of old whatsapp function** | ⚠️ **USER ACTION REQUIRED** |
| Supabase deployment | ⏸️ Blocked (waiting for manual step) |

---

**Next Step:** User must manually delete `whatsapp(us-central1)` via Supabase Console, then run `supabase deploy --only functions`.
