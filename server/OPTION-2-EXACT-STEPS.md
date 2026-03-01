# 🎯 OPȚIUNEA 2 - Pași Exacți (1 minut)

## Pasul 1: legacy hosting Dashboard

Mergi la: https://legacy hosting.app

## Pasul 2: Găsește serviciul

Caută și click pe: **web-production-f0714.up.legacy hosting.app**

## Pasul 3: Disconnect sursa veche

1. Click tab **Settings**
2. Scroll la secțiunea **Source**
3. Dacă vezi un repo conectat, click **Disconnect**

## Pasul 4: Connect repo nou

1. Tot în **Source**, click **Connect Repo**
2. Selectează: **SuperPartyByAI/superparty-ai-backend**
3. Branch: **main** (IMPORTANT: main, nu master!)
4. Click **Connect**

## Pasul 5: Adaugă variabilele

1. Click tab **Variables**
2. Click **Raw Editor** (sus dreapta)
3. **ȘTERGE TOT** ce e acolo
4. **PASTE** asta:

```
OPENAI_API_KEY=<OPENAI_KEY_REDACTED>
TWILIO_ACCOUNT_SID=[REDACTED_TWILIO]
TWILIO_AUTH_TOKEN=5c6670d39a1dbf46d47ecdaa244b91d9
TWILIO_PHONE_NUMBER=+12182204425
BACKEND_URL=https://whats-app-ompro.ro
COQUI_API_URL=https://whats-app-ompro.ro
NODE_ENV=production
PORT=5001
```

5. Click **Save** (sau **Update Variables**)

## Pasul 6: Așteaptă deploy

legacy hosting va redeploya automat. Durează ~2-3 minute.

Verifică în tab **Deployments** - când vezi "Success" e gata.

## Pasul 7: Verifică logs

Click tab **Logs** - ar trebui să vezi:

```
🚀 SuperParty Backend - WhatsApp + Voice
📡 Server running on port 5001
🎤 Voice: Kasya (Coqui XTTS)
✅ Ready to accept connections
```

## Pasul 8: TESTEAZĂ!

**Sună la: +1 (218) 220-4425**

Ar trebui să auzi:

> "Bună ziua, SuperParty, cu ce vă ajut?"

Cu vocea Kasya (clonată cu Coqui XTTS)!

---

## ✅ Twilio e deja configurat!

Webhook-ul e deja setat automat de v7.0:

- URL: `https://whats-app-ompro.ro/api/voice/incoming`
- Method: POST

Nu trebuie să faci nimic în Twilio!

---

## ❌ Dacă nu merge:

1. Verifică că branch-ul e **main** (nu master)
2. Verifică că toate variabilele sunt copiate corect
3. Verifică logs în legacy hosting pentru erori
4. Așteaptă 3-4 minute pentru deploy complet
