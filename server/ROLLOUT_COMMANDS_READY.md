# 🚀 ROLLOUT COMMANDS - WhatsApp Integration Ready

**Generated**: 2026-01-18  
**Branch**: audit-whatsapp-30  
**Status**: ✅ **READY FOR MANUAL ACCEPTANCE TESTS**

---

## ✅ PRE-FLIGHT CHECKS COMPLETED

### Backend Health
```bash
curl -sS https://whats-app-ompro.ro/health | jq
```
**Expected**: `status: "healthy"`, `database.status: "connected"`, `accounts.max: 30`

**Current Status**: ✅ HEALTHY

### Supabase Functions Deployed (us-central1)
```bash
supabase functions:list | grep -E "whatsapp|client|aggregate"
```

**Critical Functions**:
- ✅ `whatsappExtractEventFromThread` (v2, callable, us-central1)
- ✅ `clientCrmAsk` (v2, callable, us-central1)
- ✅ `aggregateClientStats` (v2, database.written trigger, us-central1)
- ✅ `whatsappProxyGetAccounts`, `whatsappProxyAddAccount`, `whatsappProxySend`, etc.

⚠️ **BLOCKER**: Old v1 "whatsapp" function exists (2048MB, us-central1).  
**ACTION REQUIRED**: Delete manually from Supabase Console:
```
https://console.supabase.google.com/project/superparty-frontend/functions
→ Filter: "1st gen" → Find "whatsapp" → Delete → Confirm
```

### Flutter Region Consistency
✅ **FIXED**: `whatsappExtractEventFromThread` now calls `us-central1` (was `europe-west1`)  
✅ **VERIFIED**: `clientCrmAsk` calls `us-central1`  
✅ **VERIFIED**: All other callables use `us-central1`

### Supabase Deploy Hooks
✅ **ADDED**: `supabase.json` now includes predeploy hooks:
```json
"functions": {
  "source": "functions",
  "predeploy": [
    "npm --prefix functions ci",
    "npm --prefix functions run build"
  ]
}
```

---

## 🔧 FIXES APPLIED

### 1. Region Mismatch (CRITICAL)
**File**: `superparty_flutter/lib/services/whatsapp_api_service.dart`  
**Change**: Line 293: `europe-west1` → `us-central1`

**Before**:
```dart
final functions = SupabaseFunctions.instanceFor(region: 'europe-west1');
```

**After**:
```dart
final functions = SupabaseFunctions.instanceFor(region: 'us-central1');
```

**Impact**: CRM "Extract Event" will now work (was 404 NOT FOUND).

### 2. Supabase.json Predeploy Hooks
**File**: `supabase.json`  
**Added**: Build step before deploy to prevent "dist/index.js missing" warnings

---

## 📱 MANUAL ACCEPTANCE TESTS - STEP BY STEP

### Prerequisites
1. **Admin User Setup** (REQUIRED FIRST):
   - Go to: https://console.supabase.google.com/project/superparty-frontend/database/data/~2Fusers~2FFBQUjlK2dFNjv9uvUOseV85uXmE3
   - Add/Edit field: `role` = `admin` (string)
   - Save

2. **Delete Old v1 Function** (if exists):
   - Go to: https://console.supabase.google.com/project/superparty-frontend/functions
   - Filter: "1st gen"
   - Find "whatsapp" (2048MB) → Delete

3. **Android Emulator Running**:
   ```bash
   flutter emulators --launch Medium_Phone_API_36.1
   # Wait ~20 seconds
   flutter devices  # Verify emulator-5554 appears
   ```

### Launch Flutter App
```bash
cd /Users/universparty/Aplicatie-SuperpartyByAi/superparty_flutter
flutter run -d emulator-5554
```

**Wait for**: `[flutter] Starting app...` + Home screen visible

---

## 🧪 TEST EXECUTION ORDER

### TEST 1: Pair WhatsApp Account (QR Code)
**RUN_ID**: `T20260118_030620`

1. **In Flutter App** (Android emulator):
   - Navigate: **Menu → WhatsApp → Accounts**
   - Tap: **"Add Account"**
   - Enter:
     - **Name**: `WA-TEST-T20260118_030620`
     - **Phone**: (your WhatsApp test number)
   - Tap: **"Add"**
   - **Verify**: QR code displays

2. **On Physical WhatsApp Phone**:
   - Open WhatsApp
   - Go to: **Settings → Linked Devices**
   - Tap: **"Link a Device"**
   - Scan QR code from emulator

3. **Expected Result**:
   - Status in app: `needs_qr` → `connecting` → `connected` ✅
   - Appears in Accounts list

**Evidence**:
- [ ] Screenshot: QR code
- [ ] Screenshot: Status "connected"
- [ ] accountId: `_______________`

**Logs to check** (if failure):
```bash
supabase functions:log --only whatsappProxyAddAccount --lines 200
```

---

### TEST 2: Inbox Shows Threads
1. **In Flutter App**:
   - Navigate: **WhatsApp → Inbox**
   - Select account: `WA-TEST-T20260118_030620`

2. **Expected Result**:
   - Threads list renders (may be empty initially)
   - No crashes or errors

**Evidence**:
- [ ] Screenshot: Inbox screen
- [ ] Thread count: `_______________`

---

### TEST 3: Receive Message (Client → WA Account)
1. **From Separate Client Phone**:
   - Send WhatsApp message to test account number:
     ```
     TEST INBOUND T20260118_030620 1
     ```

2. **In Flutter App → Inbox**:
   - **Verify**: New thread appears
   - Tap thread → Chat opens
   - **Verify**: Message visible

3. **Expected Result**:
   - Message persisted in Database:
     - `threads/{accountId}__{remoteJid}` exists
     - `threads/{threadId}/messages/{messageId}` exists
     - direction: "inbound"

**Evidence**:
- [ ] Screenshot: Message in Chat
- [ ] threadId: `_______________`
- [ ] messageId: `_______________`
- [ ] Client phone (E.164): `_______________`

**Database Verification**:
```
Supabase Console → Database → threads/{threadId}/messages
```

---

### TEST 4: Send Message (App → Client)
1. **In Flutter App → Chat**:
   - Type:
     ```
     TEST OUTBOUND T20260118_030620 1
     ```
   - Send

2. **On Client Phone**:
   - **Verify**: Message received ✅

3. **Expected Result**:
   - Database: message with direction="outbound", status="sent"/"delivered"
   - legacy hosting logs show send success

**Evidence**:
- [ ] Screenshot: Sent message in app
- [ ] Screenshot: Received on client phone
- [ ] messageId: `_______________`
- [ ] Status in Database: `_______________`

**Logs to check** (if failure):
```bash
supabase functions:log --only whatsappProxySend --lines 200
```

---

### TEST 5: Restart Safety (No Lost Conversations)
1. **Trigger legacy hosting Restart**:
   - legacy hosting Dashboard → whats-upp-production → **Restart**
   - Wait ~60 seconds

2. **Verify legacy hosting Health**:
   ```bash
   curl -sS https://whats-app-ompro.ro/health | jq '.status'
   ```
   **Expected**: `"healthy"`

3. **In Flutter App**:
   - **Verify**: Account still "connected" (no new QR)
   - **Verify**: Previous messages still visible
   - Send another message:
     ```
     TEST OUTBOUND T20260118_030620 2 AFTER RESTART
     ```
   - From client phone, send:
     ```
     TEST INBOUND T20260118_030620 2 AFTER RESTART
     ```

4. **Expected Result**:
   - ✅ Account reconnects automatically
   - ✅ Old messages preserved (Database = source of truth)
   - ✅ New messages work

**Evidence**:
- [ ] legacy hosting health after restart: PASS/FAIL
- [ ] Auto-reconnect: PASS/FAIL
- [ ] Messages preserved: PASS/FAIL

---

### TEST 6: CRM - Extract Event
1. **In Flutter App → Chat** (from Test 3/4):
   - Tap: **CRM Panel** or **Extract Event** button

2. **Expected Result**:
   - Draft event rendered with fields:
     - date, time, address, personaje, suma
   - Audit write in:
     - `threads/{threadId}/extractions/{extractionId}`

**Evidence**:
- [ ] Screenshot: Draft event
- [ ] Fields populated: YES/NO

**Logs to check** (if failure):
```bash
supabase functions:log --only whatsappExtractEventFromThread --lines 200
```

---

### TEST 7: CRM - Save Event
1. **In CRM Panel**:
   - Review draft from Test 6
   - Tap: **Save Event**

2. **Expected Result**:
   - ✅ New document in `evenimente` collection
   - ✅ Fields: phoneE164, accountId, threadId, isArchived=false
   - ✅ **Each Save creates NEW event** (no overwrites)

**Evidence**:
- [ ] eventId: `_______________`
- [ ] Database path: `evenimente/{eventId}`

---

### TEST 8: CRM - Aggregate Client Stats
**AUTOMATED TRIGGER** (Cloud Function)

1. **After Test 7**, verify:
   - Supabase Function `aggregateClientStats` triggered
   - `clients/{phoneE164}` updated:
     - `eventsCount` incremented
     - `lifetimeSpend*` updated

**Evidence**:
- [ ] Database path: `clients/{phoneE164}`
- [ ] eventsCount: `_______________`
- [ ] lifetimeSpend: `_______________`

**Logs to check** (if not updated):
```bash
supabase functions:log --only aggregateClientStats --lines 200
```

---

### TEST 9: CRM - Ask AI
1. **In Flutter App**:
   - Navigate: **Client Profile** (for test client phone)
   - Tap: **Ask AI**
   - Type:
     ```
     Câți bani a cheltuit clientul cu numărul {phoneE164}?
     ```

2. **Expected Result**:
   - AI answer matches `clients.lifetimeSpend*`
   - References saved events

**Evidence**:
- [ ] Screenshot: AI answer
- [ ] Matches Database: YES/NO

**Logs to check** (if failure):
```bash
supabase functions:log --only clientCrmAsk --lines 200
```

---

## 📊 FINAL CHECKLIST

### Infrastructure
- [ ] legacy hosting backend: HEALTHY
- [ ] Supabase Functions: all deployed us-central1
- [ ] Old v1 "whatsapp" function: DELETED
- [ ] Flutter region: us-central1 (fixed)
- [ ] Admin user: role=admin set

### Manual Tests
- [ ] TEST 1: Pair QR → connected
- [ ] TEST 2: Inbox shows threads
- [ ] TEST 3: Receive message persisted
- [ ] TEST 4: Send message delivered
- [ ] TEST 5: Restart safety (no data loss)
- [ ] TEST 6: CRM Extract Event
- [ ] TEST 7: CRM Save Event
- [ ] TEST 8: Aggregate stats updated
- [ ] TEST 9: Ask AI returns correct data

---

## 🚨 BLOCKERS

### CRITICAL (Must fix before testing)
1. ❌ **Old v1 "whatsapp" function exists** (may cause conflicts)
   - **Fix**: Delete manually from Supabase Console
   - **URL**: https://console.supabase.google.com/project/superparty-frontend/functions

2. ❌ **Admin user not set** (cannot access Accounts screen)
   - **Fix**: Set `users/FBQUjlK2dFNjv9uvUOseV85uXmE3` with `role: "admin"`
   - **URL**: https://console.supabase.google.com/project/superparty-frontend/database

### RESOLVED
- ✅ Region mismatch: FIXED (whatsappExtractEventFromThread now us-central1)
- ✅ Supabase.json predeploy hooks: ADDED
- ✅ Flutter analysis: PASSED (1 deprecation warning, non-blocking)

---

## 📝 IMPORTANT NOTES

### App Check (Non-Blocking)
**Current Status**: Disabled (403 warning in logs)  
**Impact**: Emulator uses placeholder token (functional, but less secure)  
**Action**: Safe to ignore for testing; enable in production later

### Supabase CLI Log Commands
**CORRECT**:
```bash
supabase functions:log --only <functionName> --lines 200
```

**INCORRECT** (will fail):
```bash
supabase functions:log --only <functionName> --lines 200  # ❌ Invalid flag
```

---

## 🎯 NEXT STEPS

1. **Delete old v1 function** (2 minutes)
2. **Set admin role** (1 minute)
3. **Launch Android emulator** (30 seconds)
4. **Run Flutter app**: `flutter run -d emulator-5554`
5. **Execute tests 1-9** in order (~30 minutes total)
6. **Update checklist** with PASS/FAIL + evidence

---

**Generated by**: Cursor Agent  
**Last Updated**: 2026-01-18 02:00 UTC
