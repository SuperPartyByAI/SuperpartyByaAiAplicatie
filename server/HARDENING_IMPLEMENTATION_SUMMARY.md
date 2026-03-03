# Hardening Implementation Summary

**Date:** 2026-01-26  
**Branch:** `main`  
**Backend:** Hetzner (no legacy hosting).

---

## ✅ **Implemented Hardening Items**

### **1. Security: Delete Account via Proxy (Super-Admin Only)**

**Problem:** Flutter `deleteAccount()` called the WhatsApp backend directly, bypassing Supabase auth.

**Solution:**
- `whatsappProxyDeleteAccount` in `functions/whatsappProxy.js`
- Requires super-admin auth (`requireSuperAdmin`)
- `WhatsAppApiService.deleteAccount()` calls Functions proxy, not backend direct
- Forwards `Authorization` (Supabase ID token) to backend when provided

**Files:** `whatsappProxy.js`, `index.js`, `whatsapp_api_service.dart`

---

### **2. Security: Backfill Account via Proxy**

**Problem:** Backfill was only via backend admin token, not Supabase auth.

**Solution:**
- `whatsappProxyBackfillAccount` in `functions/whatsappProxy.js`
- Requires super-admin auth
- Forwards to backend `POST /api/whatsapp/backfill/:accountId`
- Forwards incoming `Authorization` (Supabase ID token) to backend; no `ADMIN_TOKEN`

**Files:** `whatsappProxy.js`, `index.js`

---

### **3. Flutter Schema Verification**

- ✅ Inbox: `orderBy('lastMessageAt', descending: true)`; index exists
- ✅ Chat: `orderBy('tsClient')`; backend writes `tsClient`
- ✅ Client Profile: `orderBy('date', descending: true)` where `phoneE164`
- ✅ Send uses `sendViaProxy()` (not direct Database)
- ✅ Save Event: `createdBy`, `schemaVersion`, `isArchived=false`

---

## 🔍 **Audit Results**

### **Proxy Exports (all use `WHATSAPP_BACKEND_BASE_URL` secret):**
- ✅ `whatsappProxyGetAccounts`
- ✅ `whatsappProxyAddAccount`
- ✅ `whatsappProxyRegenerateQr`
- ✅ `whatsappProxyGetThreads`
- ✅ `whatsappProxyDeleteAccount`
- ✅ `whatsappProxyBackfillAccount`
- ✅ `whatsappProxySend`

### **Callables:**
- ✅ `whatsappExtractEventFromThread`, `clientCrmAsk`

### **Security Rules**
- ✅ `threads` / `messages` / `outbox`: never delete; outbox server-only writes
- ✅ `evenimente`: create requires `createdBy == uid`, `isArchived == false`, `schemaVersion in [2, 3]`

---

## 🚀 **Next Steps**

1. **Deploy:** Follow `RUNBOOK_DEPLOY_PROD.md`
2. **Test:** Acceptance tests (2 accounts + 1 client)
3. **Onboard:** 30 accounts (1 backend instance)

---

**END OF HARDENING SUMMARY**
