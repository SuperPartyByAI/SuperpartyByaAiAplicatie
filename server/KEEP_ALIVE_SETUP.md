# 🔋 Keep-Alive System - Setup Guide

## 📋 Ce Face Sistemul

Keep-alive menține aplicația "vie" în background prin notificări periodice.

**3 Moduri disponibile:**

- **30 minute** (~8% baterie/zi) - Balansat
- **1 oră** (~4% baterie/zi) - Recomandat
- **Smart** (~2% baterie/zi) - Doar când e necesar

---

## 🚀 Deployment

### 1. Build Frontend

```bash
cd kyc-app/kyc-app
npm run build
```

### 2. Deploy Functions

**IMPORTANT:** Alege DOAR UN MOD (comentează celelalte în `functions/index.js`)

**Opțiunea A: 30 minute**

```javascript
// ACTIVAT
exports.keepAlive30min = functions.pubsub
  .schedule('every 30 minutes')
  .onRun(async (context) => { ... });

// DEZACTIVAT (comentează)
// exports.keepAlive1hour = ...
// exports.keepAliveSmart = ...
```

**Opțiunea B: 1 oră (RECOMANDAT)**

```javascript
// DEZACTIVAT
// exports.keepAlive30min = ...

// ACTIVAT
exports.keepAlive1hour = functions.pubsub
  .schedule('every 1 hours')
  .onRun(async (context) => { ... });

// DEZACTIVAT
// exports.keepAliveSmart = ...
```

**Opțiunea C: Smart**

```javascript
// DEZACTIVAT
// exports.keepAlive30min = ...
// exports.keepAlive1hour = ...

// ACTIVAT
exports.keepAliveSmart = functions.pubsub
  .schedule('every 30 minutes')
  .onRun(async (context) => { ... });
```

**Deploy:**

```bash
cd functions
npm install
supabase deploy --only functions
```

### 3. Deploy Hosting

```bash
cd kyc-app/kyc-app
supabase deploy --only hosting
```

---

## 🧪 Testing

### 1. Login cu Admin Account

```
Email: ursache.andrei1995@gmail.com
```

### 2. Verifică Permisiuni

- Browser va cere permisiune pentru notificări
- Acceptă permisiunea

### 3. Verifică Token în Database

```
Database → users → [userId] → fcmToken
```

Ar trebui să vezi un token salvat.

### 4. Test Manual (Supabase Console)

```
Supabase Console → Cloud Messaging → Send test message
Token: [token-ul din Database]
```

### 5. Verifică Logs

```bash
supabase functions:log --only keepAlive1hour
```

Ar trebui să vezi:

```
⏰ Keep-alive 1hour triggered
Sending keep-alive to X users
✅ Keep-alive sent to X users
```

---

## 📊 Monitoring

### Verifică Consum Baterie

**Android:**

```
Setări → Baterie → Utilizare baterie → SuperParty
```

**iOS:**

```
Setări → Baterie → Utilizare baterie (ultimele 24h)
```

### Verifică Notificări

**Chrome DevTools:**

```
F12 → Application → Service Workers
→ Push Messaging
```

### Verifică Database

```
users/[userId]/
  - fcmToken: "..."
  - notificationsEnabled: true
  - lastActive: timestamp
```

---

## ⚙️ Configurare

### Schimbă Frecvența

**În `functions/index.js`:**

```javascript
// De la 1 oră la 2 ore
exports.keepAlive2hours = functions.pubsub.schedule('every 2 hours').onRun(async context => {
  await sendKeepAliveNotifications('2hours');
  return null;
});
```

### Schimbă Orele de Lucru (Smart Mode)

```javascript
// De la 9-22 la 8-20
const hour = new Date().getHours();
if (hour < 8 || hour > 20) {
  console.log('⏭️ Outside work hours, skipping');
  return null;
}
```

### Dezactivează Keep-Alive

**Opțiunea 1: Comentează funcția în `functions/index.js`**

```javascript
// exports.keepAlive1hour = ...
```

**Opțiunea 2: Șterge funcția din Supabase**

```bash
supabase functions:delete keepAlive1hour
```

---

## 🐛 Troubleshooting

### Notificările nu sosesc

**1. Verifică permisiuni:**

```javascript
console.log(Notification.permission); // Ar trebui "granted"
```

**2. Verifică Service Worker:**

```javascript
navigator.serviceWorker.getRegistration().then(reg => {
  console.log('SW registered:', !!reg);
});
```

**3. Verifică token în Database:**

```
Database → users → [userId] → fcmToken
```

### Consum baterie prea mare

**1. Reduce frecvența:**

- De la 30 min la 1 oră
- Sau activează Smart mode

**2. Verifică logs pentru erori:**

```bash
supabase functions:log
```

### iOS nu primește notificări

**Limitare:** Safari PWA nu suportă push notifications când app-ul e închis.

**Soluție:** Transformă în native app cu Capacitor.

---

## 📈 Consum Baterie Estimat

| Mod        | Notificări/Zi | Consum Baterie | Când Folosești    |
| ---------- | ------------- | -------------- | ----------------- |
| **30 min** | 48            | ~8%            | Utilizare intensă |
| **1 oră**  | 24            | ~4%            | **Recomandat**    |
| **Smart**  | 10-26         | ~2%            | Utilizare normală |

---

## 🔒 Securitate

**Doar admin primește notificări:**

```javascript
// În App.jsx
if (supabaseUser.email === 'ursache.andrei1995@gmail.com') {
  await initializePushNotifications();
}
```

**Pentru alți useri:**

- Șterge condiția din App.jsx
- Toți userii vor primi keep-alive

---

## 📝 Notes

- Keep-alive NU garantează că app-ul rămâne deschis
- Android Doze Mode poate întârzia notificările
- iOS Safari PWA nu suportă push când app-ul e închis
- Pentru persistență reală, folosește Capacitor (native app)

---

## 🆘 Support

Probleme? Verifică:

1. Logs: `supabase functions:log`
2. Database: users/[userId]/fcmToken
3. Browser Console: F12 → Console
4. Service Worker: F12 → Application → Service Workers
