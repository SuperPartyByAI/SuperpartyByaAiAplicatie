# 🔧 WhatsApp pe Supabase - Fix pentru Sesiuni Persistente

## ❌ Problema Actuală

Supabase Functions folosesc **ephemeral storage** (`/tmp`) care se șterge la fiecare **cold start** (după ~15 min inactivitate).

**Rezultat:** Contul WhatsApp se deconectează și trebuie reconectat manual cu QR code/pairing code.

---

## ✅ Soluția: Database pentru Sesiuni

Codul tău **deja are** `session-store.js` care salvează sesiunile în Database! Problema este că:

1. **Sesiunea se salvează** în Database când te conectezi
2. **Sesiunea NU se restaurează** automat la cold start
3. **Funcția `autoRestoreSessions()`** există dar nu funcționează corect

---

## 🔍 Ce Trebuie Verificat

### 1. Verifică dacă sesiunea este în Database

Mergi la **Supabase Console** → **Database Database** → caută colecția `whatsapp_sessions`.

Ar trebui să vezi:

```
whatsapp_sessions/
  └── account_1766947637246/
      ├── accountId: "account_1766947637246"
      ├── creds: { ... }  ← Aici sunt credențialele WhatsApp
      ├── updatedAt: "2025-12-28T..."
      └── savedAt: timestamp
```

**Dacă NU există:** Sesiunea nu s-a salvat niciodată → trebuie să te reconectezi și să verifici logs.

**Dacă există:** Sesiunea există dar nu se restaurează → trebuie să fixăm `autoRestoreSessions()`.

---

## 🛠️ Fix 1: Forțează Restaurarea la Pornire

Modifică `functions/whatsapp/manager.js` să restaureze sesiunile **ÎNAINTE** de a genera QR code:

```javascript
// În funcția createAccount(), ÎNAINTE de useMultiFileAuthState:

async createAccount(phoneNumber = null) {
  const accountId = `account_${Date.now()}`;
  const sessionPath = path.join(this.sessionsPath, accountId);

  // ✅ ADAUGĂ AICI: Încearcă să restaurezi sesiunea din Database
  const restored = await sessionStore.restoreSession(accountId, sessionPath);

  if (restored) {
    console.log(`✅ [${accountId}] Session restored from Database, connecting...`);
  } else {
    console.log(`ℹ️ [${accountId}] No saved session, will generate QR code`);
  }

  // Continuă cu useMultiFileAuthState...
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  // ...
}
```

---

## 🛠️ Fix 2: Salvează Sesiunea la Fiecare Update

Modifică event handler-ul `connection.update` să salveze sesiunea **imediat** după conectare:

```javascript
sock.ev.on('connection.update', async update => {
  const { connection, lastDisconnect, qr } = update;

  if (connection === 'open') {
    console.log(`✅ [${accountId}] Connected!`);
    account.status = 'connected';

    // ✅ ADAUGĂ AICI: Salvează sesiunea IMEDIAT
    await sessionStore.saveSession(accountId, sessionPath);
    console.log(`💾 [${accountId}] Session saved to Database`);
  }
  // ...
});
```

---

## 🛠️ Fix 3: Keep-Alive pentru a Preveni Cold Starts

Supabase Functions "adorm" după 15 minute. Soluții:

### Opțiunea A: Cloud Scheduler (Cron Job)

Creează un **Cloud Scheduler** care apelează funcția la fiecare 10 minute:

```bash
# În Supabase Console → Cloud Scheduler → Create Job
Name: whatsapp-keepalive
Frequency: */10 * * * *  (la fiecare 10 minute)
Target: HTTP
URL: https://us-central1-superparty-frontend.cloudfunctions.net/whatsapp
Method: GET
```

**Cost:** ~$0.10/lună pentru 4,320 requests/lună

### Opțiunea B: External Cron (UptimeRobot - GRATIS)

1. Mergi la [uptimerobot.com](https://uptimerobot.com) (GRATIS)
2. Creează un monitor:
   - **Type:** HTTP(s)
   - **URL:** `https://us-central1-superparty-frontend.cloudfunctions.net/whatsapp`
   - **Interval:** 5 minutes (GRATIS)
3. Done! Funcția va fi apelată la fiecare 5 minute → **NU mai are cold starts**

---

## 🛠️ Fix 4: Metadata pentru Sesiuni

Modifică `session-store.js` să salveze și metadata (phone, name):

```javascript
async saveSession(accountId, sessionPath, account = null) {
  try {
    if (!this.db) await this.initialize();

    const credsPath = path.join(sessionPath, 'creds.json');

    if (!fs.existsSync(credsPath)) {
      console.log(`⚠️ [${accountId}] No creds.json found, skipping save`);
      return;
    }

    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));

    // ✅ ADAUGĂ metadata
    const data = {
      accountId,
      creds: creds,
      metadata: account ? {
        name: account.name,
        phone: account.phone,
        createdAt: account.createdAt
      } : null,
      updatedAt: new Date().toISOString(),
      savedAt: database.admin.database.FieldValue.serverTimestamp()
    };

    await this.db.collection('whatsapp_sessions').doc(accountId).set(data);
    console.log(`💾 [${accountId}] Session saved to Database`);
  } catch (error) {
    console.error(`❌ [${accountId}] Failed to save session:`, error.message);
  }
}
```

---

## 📋 Pași de Urmat

### 1. **Verifică Database** (ACUM)

- Supabase Console → Database → `whatsapp_sessions`
- Există sesiunea? Da/Nu?

### 2. **Aplică Fix-urile** (5 min)

- Fix 1: Restaurare la pornire
- Fix 2: Salvare imediată după conectare
- Fix 3: Keep-Alive (UptimeRobot - GRATIS)
- Fix 4: Metadata pentru sesiuni

### 3. **Deploy și Test** (2 min)

```bash
supabase deploy --only functions
```

### 4. **Reconectează WhatsApp** (1 min)

- Generează QR code nou
- Conectează-te
- Verifică că sesiunea se salvează în Database

### 5. **Test Cold Start** (15 min)

- Așteaptă 15 minute (sau forțează cold start)
- Apelează API-ul
- Verifică că sesiunea se restaurează automat

---

## 🎯 Rezultat Final

După aplicarea fix-urilor:

✅ **Sesiunea se salvează** în Database la conectare  
✅ **Sesiunea se restaurează** automat la cold start  
✅ **Keep-Alive** previne cold starts (UptimeRobot GRATIS)  
✅ **WhatsApp rămâne conectat** 24/7 fără intervenție manuală

---

## 💰 Costuri

- **Supabase Functions:** $0-2/lună (invocations + compute)
- **Database:** $0 (sub 1GB storage, sub 50k reads/day)
- **Cloud Scheduler:** $0.10/lună (opțional, dacă nu folosești UptimeRobot)
- **UptimeRobot:** $0 (GRATIS pentru 50 monitoare)

**Total:** **$0-2/lună** pentru WhatsApp 24/7! 🎉

---

## 🆘 Dacă Nu Funcționează

1. **Verifică logs:**

   ```bash
   supabase functions:log --only whatsapp
   ```

2. **Verifică Database Rules:**

   ```javascript
   // Database Rules trebuie să permită read/write pentru Functions
   service cloud.database {
     match /databases/{database}/documents {
       match /whatsapp_sessions/{document=**} {
         allow read, write: if true; // Temporar pentru debug
       }
     }
   }
   ```

3. **Test manual restaurare:**
   ```bash
   curl https://us-central1-superparty-frontend.cloudfunctions.net/whatsapp/api/whatsapp/restore
   ```

---

**Spune-mi ce vezi în Database Console și aplicăm fix-urile!** 🚀
