# Flutter WhatsApp - Status Verificat (Ce Există / Ce Lipsește)

**Date:** 2026-01-17  
**Scope:** Verificare completă a ce există în Flutter pentru WhatsApp + CRM

---

## ✅ **CE EXISTĂ ÎN FLUTTER**

### **1. Screens (2 files)**

#### **A) `whatsapp_screen.dart`** ✅
**Locație:** `lib/screens/whatsapp/whatsapp_screen.dart`

**Funcționalitate:**
- Meniu principal WhatsApp
- Button "Deschide WhatsApp" (wa.me extern)
- Button "Manage Accounts" (doar admin) → navighează la `/whatsapp/accounts`
- Verificare instalare WhatsApp pe device

**Ce NU are:**
- ❌ Inbox/Chat pentru conversații WhatsApp
- ❌ Thread list sau message list
- ❌ CRM Panel

---

#### **B) `whatsapp_accounts_screen.dart`** ✅
**Locație:** `lib/screens/whatsapp/whatsapp_accounts_screen.dart`

**Funcționalitate completă:**
- ✅ Listă conturi (`getAccounts()`)
- ✅ Add Account (`addAccount(name, phone)`)
- ✅ Regenerate QR (`regenerateQr(accountId)`)
- ✅ Delete Account (`deleteAccount(accountId)`)
- ✅ Display QR Code (cu `qr_flutter`, data URL base64)
- ✅ Status badges (connected/qr_ready/disconnected)
- ✅ QR Page URL fallback (deschide în browser)

**Ce are:**
- Status display (connected/qr_ready/etc.)
- QR code display (când `status == qr_ready` și `qrCode != null`)
- Pairing code display (fallback)
- Loading states + error handling
- Refresh button + pull-to-refresh

**Ce NU are:**
- ❌ Inbox/Threads list (nu există screen pentru conversații)
- ❌ Chat screen (nu există ecran pentru mesaje)
- ❌ CRM Panel

---

### **2. Services (2 files)**

#### **A) `whatsapp_api_service.dart`** ✅
**Locație:** `lib/services/whatsapp_api_service.dart`

**Metode existente:**
- ✅ `getAccounts()` → `GET /api/whatsapp/accounts` (legacy hosting backend)
- ✅ `addAccount(name, phone)` → `POST /api/whatsapp/add-account`
- ✅ `regenerateQr(accountId)` → `POST /api/whatsapp/regenerate-qr/:accountId`
- ✅ `deleteAccount(accountId)` → `DELETE /api/whatsapp/accounts/:accountId`
- ✅ `sendViaProxy(threadId, accountId, toJid, text, clientMessageId)` → `POST /whatsappProxySend` (Supabase Functions)
- ✅ `qrPageUrl(accountId)` → returnează URL pentru QR page

**Ce NU are:**
- ❌ `getThreads(accountId)` → `GET /api/whatsapp/threads/:accountId`
- ❌ `getMessages(accountId, threadId)` → `GET /api/whatsapp/messages/:accountId/:threadId`
- ❌ `extractEventFromThread(threadId, accountId, phoneE164, dryRun)` → `whatsappExtractEventFromThread`
- ❌ `getClientProfile(phoneE164)` → query `clients/{phoneE164}`
- ❌ `getClientEvents(phoneE164)` → query `evenimente` where `phoneE164`
- ❌ `askClientAI(phoneE164, question)` → `clientCrmAsk`

---

#### **B) `whatsapp_service.dart`** ✅
**Locație:** `lib/services/whatsapp_service.dart`

**Funcționalitate:**
- ✅ `openWhatsAppChat(phone, message)` → deschide WhatsApp extern (wa.me)
- ✅ `isWhatsAppInstalled()` → verificare instalare pe device

**Note:** Acesta e pentru deschiderea WhatsApp **extern**, nu pentru conversații în-app.

---

### **3. AI Chat Screen (legat de evenimente, nu de WhatsApp)**

#### **`ai_chat_screen.dart`** ✅
**Locație:** `lib/screens/ai_chat/ai_chat_screen.dart`

**Ce face:**
- ✅ Folosește `chatEventOps` pentru creare evenimente din AI Chat
- ✅ Preview (dryRun) + Confirm flow
- ✅ Idempotency prin `clientRequestId`

**Note:** Acesta e pentru **AI Chat general** (nu e legat de WhatsApp threads). Poate fi folosit ca referință pentru flow-ul "Preview → Confirm" în CRM Panel.

---

## ❌ **CE LIPSEȘTE ÎN FLUTTER (pentru CRM WhatsApp)**

### **1. Screens (3 files noi necesare)**

#### **A) Inbox/Threads Screen** ❌
**Locație:** `lib/screens/whatsapp/whatsapp_inbox_screen.dart` (NU există)

**Necesar pentru:**
- Listă thread-uri pentru un `accountId`
- Sort by `lastMessageAt` DESC
- Navigare la Chat screen când apeși pe thread

**API necesar:**
- `GET /api/whatsapp/threads/:accountId` (sau query direct Database `threads` where `accountId`)

---

#### **B) Chat Screen** ❌
**Locație:** `lib/screens/whatsapp/whatsapp_chat_screen.dart` (NU există)

**Necesar pentru:**
- Listă mesaje din `threads/{threadId}/messages`
- Input + Send button (folosește `sendViaProxy()` care există deja ✅)
- **CRM Panel** (nou, de adăugat):
  - Button "AI: Detectează petrecere (Draft)"
  - Button "Confirm & Save"
  - Button "Open Client Profile"

**API necesar:**
- `GET /api/whatsapp/messages/:accountId/:threadId` (sau query direct Database)
- `whatsappExtractEventFromThread` (callable - trebuie adăugat în service)

---

#### **C) Client Profile Screen** ❌
**Locație:** `lib/screens/whatsapp/client_profile_screen.dart` (NU există)

**Necesar pentru:**
- Header: `phoneE164`, `displayName`
- KPI Cards: `lifetimeSpendPaid`, `eventsCount`, `lastEventAt`
- Events List: query `evenimente` where `phoneE164`
- Button "Ask AI about client" (calls `clientCrmAsk`)

**API necesar:**
- Query `clients/{phoneE164}` (Database)
- Query `evenimente` where `phoneE164` (Database)
- `clientCrmAsk` (callable - trebuie adăugat în service)

---

### **2. Service Methods (3 methods noi necesare în `whatsapp_api_service.dart`)**

#### **A) `extractEventFromThread()`** ❌
```dart
Future<Map<String, dynamic>> extractEventFromThread({
  required String threadId,
  required String accountId,
  String? phoneE164,
  int lastNMessages = 50,
  bool dryRun = true,
}) async {
  // Call Supabase callable: whatsappExtractEventFromThread
  // Returns: { action, draftEvent, targetEventId?, confidence, reasons }
}
```

---

#### **B) `getClientProfile()`** ❌
```dart
Future<Map<String, dynamic>?> getClientProfile(String phoneE164) async {
  // Query Database: clients/{phoneE164}
  // Returns: { phoneE164, lifetimeSpendPaid, eventsCount, ... }
}
```

---

#### **C) `askClientAI()`** ❌
```dart
Future<Map<String, dynamic>> askClientAI({
  required String phoneE164,
  required String question,
}) async {
  // Call Supabase callable: clientCrmAsk
  // Returns: { answer, sources: [...] }
}
```

---

## 📋 **REZUMAT COMPLET**

### **✅ Există (Backend-ready):**
- WhatsApp Accounts screen complet (add/regenerate/delete)
- WhatsApp API service cu metode Accounts + Send
- AI Chat screen cu `chatEventOps` (flow Preview + Confirm)

### **❌ Lipsește (Necesar pentru CRM WhatsApp):**
- Inbox/Threads screen (listă conversații)
- Chat screen (mesaje + CRM Panel)
- Client Profile screen (KPI + events list + Ask AI)
- Service methods CRM (`extractEventFromThread`, `getClientProfile`, `askClientAI`)

---

## 🎯 **CE TREBUIE IMPLEMENTAT PENTRU CRM WHATSAPP**

### **Prioritatea 1: Service Methods**
1. Adaugă în `whatsapp_api_service.dart`:
   - `extractEventFromThread()`
   - `getClientProfile()`
   - `askClientAI()`

### **Prioritatea 2: Screens**
2. Creează `whatsapp_inbox_screen.dart` (thread list)
3. Creează `whatsapp_chat_screen.dart` (mesaje + CRM Panel)
4. Creează `client_profile_screen.dart` (KPI + events + Ask AI)

### **Prioritatea 3: Navigation**
5. Adaugă rute în `app_router.dart`:
   - `/whatsapp/inbox/:accountId`
   - `/whatsapp/chat/:accountId/:threadId`
   - `/whatsapp/client/:phoneE164`

---

## ✅ **CONCLUZIE**

**Backend CRM este implementat complet:**
- ✅ `clients/{phoneE164}` collection
- ✅ `aggregateClientStats` trigger
- ✅ `whatsappExtractEventFromThread` callable
- ✅ `clientCrmAsk` callable

**Flutter UI pentru CRM WhatsApp lipsește complet:**
- ❌ Nu există Inbox/Chat screens
- ❌ Nu există CRM Panel
- ❌ Nu există Client Profile screen
- ❌ Nu există service methods pentru CRM

**Ce funcționează acum:**
- ✅ Accounts management (add/regenerate/delete) funcționează
- ✅ Send message via proxy funcționează (dacă ai threadId)
- ✅ AI Chat pentru evenimente funcționează (dar e separat de WhatsApp)

**Pentru a avea CRM WhatsApp complet, trebuie implementat:**
1. Service methods CRM (3 methods)
2. Inbox screen (thread list)
3. Chat screen (mesaje + CRM Panel)
4. Client Profile screen (KPI + Ask AI)

---

**END OF STATUS**
