# Final Status - "Cap-Coadă" WhatsApp + CRM

**Date:** 2026-01-17  
**Branch:** `audit-whatsapp-30`  
**Latest Commit:** `cb1aaac0` (see git log)

---

## ✅ **CONFIRMED: What Exists (From READ-ONLY Audit)**

### **1. Backend CRM (100% Complete):**

**Supabase Functions:**
- ✅ `functions/aggregateClientStats.js` - Trigger on `evenimente/{eventId}` create/update
  - Writes to: `clients/{phoneE164}` (lifetimeSpendPaid, eventsCount, lastEventAt)
- ✅ `functions/whatsappExtractEventFromThread.js` - Callable for AI extraction
  - Reads: `threads/{threadId}/messages` (inbound only)
  - Writes: `threads/{threadId}/extractions/{messageId}` (audit)
  - Returns: `draftEvent` (does NOT write to `evenimente` directly)
- ✅ `functions/clientCrmAsk.js` - Callable for AI questions about clients
  - Reads: `clients/{phoneE164}` + `evenimente` where `phoneE164`
  - Returns: `{ answer, sources: [...] }`

**Database:**
- ✅ Rules: `clients/{phoneE164}` → `allow delete: if false` (NEVER DELETE) - Line ~385-394
- ✅ Rules: `threads/{threadId}/messages` → `allow delete: if false` (NEVER DELETE) - Line 235-236
- ✅ Rules: `threads/{threadId}/extractions` → `allow delete: if false` (NEVER DELETE) - Line 247-248
- ✅ Indexes: `evenimente` on `phoneE164 ASC, date DESC` ✅
- ✅ Indexes: `threads` on `accountId ASC, lastMessageAt DESC` ✅

**Exports (functions/index.js):**
- ✅ `aggregateClientStats` (Line 872)
- ✅ `whatsappExtractEventFromThread` (Line 875)
- ✅ `clientCrmAsk` (Line 878)

---

### **2. Flutter WhatsApp (Partial - Accounts Only):**

**Screens:**
- ✅ `whatsapp_screen.dart` - Menu (external WhatsApp + link to Accounts)
- ✅ `whatsapp_accounts_screen.dart` - Complete accounts management (add/regenerate/delete/QR)
- ❌ `whatsapp_inbox_screen.dart` - **NOT FOUND** (file does not exist)
- ❌ `whatsapp_chat_screen.dart` - **NOT FOUND** (file does not exist)
- ❌ `client_profile_screen.dart` - **NOT FOUND** (file does not exist)

**Router (`app_router.dart`):**
- ✅ `/whatsapp` route (Line 104-108) → `WhatsAppScreen`
- ✅ `/whatsapp/accounts` route (Line 110-116) → `WhatsAppAccountsScreen`
- ❌ `/whatsapp/inbox` - **NO ROUTE** (not defined)
- ❌ `/whatsapp/chat/:threadId` - **NO ROUTE** (not defined)
- ❌ `/whatsapp/client/:phoneE164` - **NO ROUTE** (not defined)

**Service (`whatsapp_api_service.dart`):**
- ✅ `getAccounts()` (Line 118)
- ✅ `addAccount()` (Line 151)
- ✅ `regenerateQr()` (Line 189)
- ✅ `deleteAccount()` (Line 222)
- ✅ `sendViaProxy()` (Line 64) - Sends via Supabase Functions `/whatsappProxySend`
- ✅ `qrPageUrl()` (Line 255)
- ❌ `extractEventFromThread()` - **NOT FOUND**
- ❌ `getClientProfile()` - **NOT FOUND**
- ❌ `askClientAI()` - **NOT FOUND**

---

### **3. legacy hosting Backend (WhatsApp):**

**Confirmed Features (from server.js):**
- ✅ Message persistence: `messages.upsert` handler (Line 1319)
- ✅ Receipts: `messages.update` + `message-receipt.update` (Line 1410, 1470)
- ✅ History sync: `messaging-history.set` handler (Line 1252)
- ✅ Sessions: `SESSIONS_PATH` env var (Line 311-314), volume mount `/app/sessions` (legacy hosting.toml Line 17)
- ✅ API endpoints: `/api/whatsapp/accounts`, `/api/whatsapp/threads/:accountId`, `/api/whatsapp/messages/:accountId/:threadId`, `/api/whatsapp/backfill/:accountId`

---

## ❌ **CONFIRMED: What's Missing (For "Cap-Coadă")**

### **Flutter UI (Inbox/Chat/CRM):**

1. **Inbox Screen** ❌
   - File: `whatsapp_inbox_screen.dart` - **DOES NOT EXIST**
   - Route: `/whatsapp/inbox` - **NOT DEFINED**
   - Feature: Thread list per `accountId` (query Database `threads` where `accountId`)

2. **Chat Screen** ❌
   - File: `whatsapp_chat_screen.dart` - **DOES NOT EXIST**
   - Route: `/whatsapp/chat/:threadId` - **NOT DEFINED**
   - Features:
     - Message list (query Database `threads/{threadId}/messages`)
     - Send button (use existing `sendViaProxy()`)
     - **CRM Panel** (buttons: Extract Event, Open Client Profile)

3. **Client Profile Screen** ❌
   - File: `client_profile_screen.dart` - **DOES NOT EXIST**
   - Route: `/whatsapp/client/:phoneE164` - **NOT DEFINED**
   - Features:
     - KPI cards (read `clients/{phoneE164}`)
     - Events list (query `evenimente` where `phoneE164`)
     - Ask AI button (call `clientCrmAsk`)

4. **Service Methods CRM** ❌
   - `extractEventFromThread()` - **NOT FOUND** (needs to call Supabase callable `whatsappExtractEventFromThread`)
   - `getClientProfile(phoneE164)` - **NOT FOUND** (needs to query Database `clients/{phoneE164}`)
   - `askClientAI(phoneE164, question)` - **NOT FOUND** (needs to call Supabase callable `clientCrmAsk`)

---

## 📋 **Final Checklist "Cap-Coadă" (What's Ready vs Missing)**

### **✅ Ready (Backend):**

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| `clients/{phoneE164}` schema | ✅ | `database.rules` Line ~385-394 | NEVER DELETE policy |
| `aggregateClientStats` trigger | ✅ | `functions/aggregateClientStats.js` | Auto-updates client stats |
| `whatsappExtractEventFromThread` callable | ✅ | `functions/whatsappExtractEventFromThread.js` | Returns draftEvent |
| `clientCrmAsk` callable | ✅ | `functions/clientCrmAsk.js` | Answers from structured data |
| Database indexes (evenimente) | ✅ | `database.indexes.json` | `phoneE164 ASC, date DESC` |
| Message persistence (backend) | ✅ | `server.js` Line 1319 | Inbound/outbound saved |
| History sync (backend) | ✅ | `server.js` Line 1252 | Best-effort ingestion |

---

### **❌ Missing (Flutter UI):**

| Component | Status | File | What's Needed |
|-----------|--------|------|---------------|
| Inbox screen | ❌ | `whatsapp_inbox_screen.dart` | Thread list + account selector |
| Chat screen | ❌ | `whatsapp_chat_screen.dart` | Messages + Send + CRM Panel |
| Client Profile screen | ❌ | `client_profile_screen.dart` | KPI + Events + Ask AI |
| Inbox route | ❌ | `app_router.dart` | `/whatsapp/inbox` |
| Chat route | ❌ | `app_router.dart` | `/whatsapp/chat/:threadId` |
| Client route | ❌ | `app_router.dart` | `/whatsapp/client/:phoneE164` |
| `extractEventFromThread()` method | ❌ | `whatsapp_api_service.dart` | Call Supabase callable |
| `getClientProfile()` method | ❌ | `whatsapp_api_service.dart` | Query Database `clients/{phoneE164}` |
| `askClientAI()` method | ❌ | `whatsapp_api_service.dart` | Call Supabase callable |

---

## 🚀 **Deploy Status (What's Ready to Deploy)**

### **Supabase (Ready):**

```bash
# All backend CRM code is committed and ready
supabase deploy --only database,functions
```

**Will deploy:**
- ✅ Database Rules (with `clients/{phoneE164}` NEVER DELETE)
- ✅ Database Indexes (with `evenimente` on `phoneE164`)
- ✅ `aggregateClientStats` trigger
- ✅ `whatsappExtractEventFromThread` callable
- ✅ `clientCrmAsk` callable

---

### **legacy hosting (No Changes Needed):**

**Backend is already running** (no new code changes for WhatsApp backend in this branch).

**Ensure env vars:**
- `SESSIONS_PATH=/app/sessions` ✅
- `SUPABASE_SERVICE_ACCOUNT_JSON=...` ✅

---

### **Flutter (Needs Implementation):**

**3 screens + 3 service methods + 3 routes** need to be implemented for "cap-coadă" flow.

---

## ✅ **CONCLUSION**

**Backend CRM is 100% complete** and ready to deploy.

**Flutter UI is incomplete:**
- ✅ Accounts management works
- ❌ Inbox/Chat/CRM screens are **MISSING** (files do not exist, routes not defined)
- ❌ CRM service methods are **MISSING**

**To close "cap-coadă" gap:**
1. Implement Flutter UI (Inbox + Chat + Client Profile screens)
2. Add service methods (3 CRM methods)
3. Add routes (3 new routes)

**Backend is ready. Flutter UI needs implementation.**

---

**END OF FINAL STATUS**
