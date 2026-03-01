# 🚀 WhatsApp Integration - Ghid Complet SuperParty

## Status Actual: ✅ DEPLOYED ȘI FUNCȚIONAL

**URL Production:** `https://us-central1-superparty-frontend.cloudfunctions.net/whatsapp`

---

## 📋 Ce Funcționează

### ✅ Implementat și Testat:

- Supabase Cloud Functions (Gen 1, Node.js 20)
- Baileys 6.5.0 pentru WhatsApp Web API
- Express.js cu CORS
- Socket.IO pentru real-time updates
- QR Code generation (FUNCȚIONEAZĂ PERFECT)
- Multi-account support (până la 20 conturi)
- Session persistence în Database
- Auto-reconnect după disconnect

### ❌ NU Funcționează:

- **Pairing Codes** - generează coduri invalide în Cloud Functions
- **SOLUȚIE:** Folosește doar QR codes

---

## 🎯 Cum Rulezi - PAȘI EXACTI

### 1️⃣ Verifică că e Deployed

```bash
# Test health check
curl https://us-central1-superparty-frontend.cloudfunctions.net/whatsapp/

# Răspuns așteptat:
# {
#   "status": "online",
#   "service": "SuperParty WhatsApp on Supabase",
#   "version": "5.0.0",
#   "accounts": 0
# }
```

---

### 2️⃣ Creează Cont WhatsApp (Generează QR Code)

```bash
curl -X POST https://us-central1-superparty-frontend.cloudfunctions.net/whatsapp/api/whatsapp/add-account \
  -H "Content-Type: application/json" \
  -d '{"name":"SuperParty Main"}'
```

**IMPORTANT:** NU trimite parametrul `phone` - vrei QR code, nu pairing code!

**Răspuns:**

```json
{
  "success": true,
  "account": {
    "id": "account_1766951966844",
    "name": "SuperParty Main",
    "status": "connecting",
    "qrCode": null,
    "pairingCode": null,
    "phone": null,
    "createdAt": "2025-12-28T19:59:26.844Z"
  }
}
```

---

### 3️⃣ Așteaptă QR Code (15-20 secunde)

```bash
# Așteaptă 20 secunde
sleep 20

# Verifică conturile
curl https://us-central1-superparty-frontend.cloudfunctions.net/whatsapp/api/whatsapp/accounts
```

**Răspuns cu QR Code:**

```json
{
  "success": true,
  "accounts": [
    {
      "id": "account_1766951966844",
      "name": "SuperParty Main",
      "status": "qr_ready",
      "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
      "pairingCode": null,
      "phone": null,
      "createdAt": "2025-12-28T19:59:26.844Z"
    }
  ]
}
```

---

### 4️⃣ Scanează QR Code

**Metoda 1: Browser**

1. Copiază string-ul `qrCode` (începe cu `data:image/png;base64,`)
2. Deschide Chrome/Edge
3. Lipește în address bar
4. Apasă Enter
5. Vei vedea QR code-ul

**Metoda 2: Salvează ca fișier**

```bash
# Extrage QR code din răspuns și salvează
curl https://us-central1-superparty-frontend.cloudfunctions.net/whatsapp/api/whatsapp/accounts | \
  jq -r '.accounts[0].qrCode' > qr.txt

# Deschide qr.txt în browser
```

**Metoda 3: În aplicație web**

```html
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..." alt="QR Code" />
```

---

### 5️⃣ Conectează WhatsApp

1. Deschide WhatsApp pe telefon
2. Mergi la **Settings** → **Linked Devices**
3. Apasă **"Link a Device"**
4. Scanează QR code-ul afișat
5. Așteaptă confirmare

---

### 6️⃣ Verifică Conexiunea

```bash
# Verifică status
curl https://us-central1-superparty-frontend.cloudfunctions.net/whatsapp/api/whatsapp/accounts
```

**Status după conectare:**

```json
{
  "success": true,
  "accounts": [
    {
      "id": "account_1766951966844",
      "name": "SuperParty Main",
      "status": "connected", // ✅ CONECTAT!
      "qrCode": null,
      "pairingCode": null,
      "phone": "40373805828", // Numărul tău
      "createdAt": "2025-12-28T19:59:26.844Z"
    }
  ]
}
```

---

### 7️⃣ Trimite Mesaj de Test

```bash
curl -X POST https://us-central1-superparty-frontend.cloudfunctions.net/whatsapp/api/whatsapp/send \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "account_1766951966844",
    "to": "40373805828",
    "message": "🎉 Test de la SuperParty!"
  }'
```

**Răspuns:**

```json
{
  "success": true
}
```

**Verifică:** Ar trebui să primești mesajul pe WhatsApp!

---

## 📡 API Endpoints Complete

### Base URL

```
https://us-central1-superparty-frontend.cloudfunctions.net/whatsapp
```

### 1. Health Check

```bash
GET /
```

### 2. Listare Conturi

```bash
GET /api/whatsapp/accounts
```

### 3. Adăugare Cont (QR Code)

```bash
POST /api/whatsapp/add-account
Content-Type: application/json

{
  "name": "Nume Cont"
}
```

### 4. Adăugare Cont (Pairing Code - NU RECOMANDAT)

```bash
POST /api/whatsapp/add-account
Content-Type: application/json

{
  "name": "Nume Cont",
  "phone": "40373805828"
}
```

⚠️ **ATENȚIE:** Pairing codes NU funcționează în Cloud Functions!

### 5. Ștergere Cont

```bash
DELETE /api/whatsapp/accounts/:accountId
```

### 6. Trimitere Mesaj

```bash
POST /api/whatsapp/send
Content-Type: application/json

{
  "accountId": "account_xxx",
  "to": "40373805828",
  "message": "Text mesaj"
}
```

**Note:**

- `to` poate fi cu sau fără `@s.whatsapp.net`
- Contul trebuie să fie `status: "connected"`

---

## 🔧 Troubleshooting

### Problema: QR Code nu apare

**Cauză:** Generarea durează 15-20 secunde

**Soluție:**

```bash
# Așteaptă și verifică din nou
sleep 20
curl https://us-central1-superparty-frontend.cloudfunctions.net/whatsapp/api/whatsapp/accounts
```

---

### Problema: "Account not connected"

**Cauză:** Contul nu e conectat sau s-a deconectat

**Soluție:**

```bash
# Verifică status
curl https://us-central1-superparty-frontend.cloudfunctions.net/whatsapp/api/whatsapp/accounts

# Dacă status != "connected", șterge și recreează
curl -X DELETE https://us-central1-superparty-frontend.cloudfunctions.net/whatsapp/api/whatsapp/accounts/account_xxx

# Creează din nou
curl -X POST https://us-central1-superparty-frontend.cloudfunctions.net/whatsapp/api/whatsapp/add-account \
  -H "Content-Type: application/json" \
  -d '{"name":"SuperParty Main"}'
```

---

### Problema: Pairing code invalid

**Cauză:** Pairing codes NU funcționează în Cloud Functions

**Soluție:** Folosește QR codes în schimb (NU trimite parametrul `phone`)

---

### Problema: Sesiunea se pierde

**Cauză:** Cloud Functions timeout sau restart

**Soluție:**

- Sesiunile sunt salvate în Database
- Auto-reconnect după restart
- Dacă nu funcționează, recreează contul

---

## 📊 Arhitectura Tehnică

### Stack:

- **Runtime:** Node.js 20
- **Platform:** Supabase Cloud Functions (Gen 1)
- **WhatsApp Library:** @whiskeysockets/baileys 6.5.0
- **Web Framework:** Express.js 4.18.2
- **Real-time:** Socket.IO 4.6.1
- **Database:** Database (session persistence)
- **QR Generation:** qrcode 1.5.3

### Fișiere Principale:

```
functions/
├── index.js                    # Entry point, Express routes
├── package.json                # Dependencies
└── whatsapp/
    ├── manager.js              # WhatsApp logic (Baileys)
    ├── session-store.js        # Database persistence
    ├── behavior.js             # Human-like behavior
    ├── rate-limiter.js         # Rate limiting
    ├── circuit-breaker.js      # Fault tolerance
    ├── webhooks.js             # Webhook notifications
    ├── advanced-health.js      # Health monitoring
    └── proxy-rotation.js       # Proxy support
```

---

## ⚠️ Limitări și Riscuri

### Limitări Tehnice:

1. **Pairing Codes NU funcționează** în Cloud Functions
2. **Timeout:** Cloud Functions au timeout de 60 secunde (Gen 1) sau 540 secunde (Gen 2)
3. **Cold Start:** Prima cerere poate dura 5-10 secunde
4. **Sesiuni:** Se pot pierde la restart (salvate în Database pentru recovery)

### Riscuri Legale:

1. **Împotriva ToS WhatsApp:** Baileys folosește WhatsApp Web API neoficial
2. **Risc de BAN:** WhatsApp poate bana contul dacă detectează automatizare
3. **NU pentru producție:** Recomandat doar pentru testare/MVP

### Recomandări pentru Producție:

1. **Twilio WhatsApp API** - Oficial, legal, $0.005/mesaj
2. **WhatsApp Business API** - Cel mai sigur, necesită aprobare
3. **MessageBird** - Alternativă la Twilio

---

## 🚀 Deploy și Maintenance

### Deploy Nou:

```bash
cd functions
npm install
cd ..
supabase deploy --only functions
```

### Verifică Logs:

```bash
supabase functions:log
```

### Monitorizare:

- Supabase Console: https://console.supabase.google.com/project/superparty-frontend/functions
- Logs în timp real: `supabase functions:log --follow`

---

## 📞 Suport

**Supabase Project:** superparty-frontend  
**Region:** us-central1  
**Function Name:** whatsapp

**Documentație:**

- Baileys: https://github.com/WhiskeySockets/Baileys
- Supabase Functions: https://supabase.google.com/docs/functions
- Twilio WhatsApp: https://www.twilio.com/whatsapp

---

**Ultima actualizare:** 2025-12-28  
**Versiune:** 5.0.0  
**Status:** ✅ PRODUCTION READY (cu QR codes)
