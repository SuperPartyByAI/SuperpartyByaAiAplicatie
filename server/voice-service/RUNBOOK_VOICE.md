# Runbook: Voice Service — Twilio Configuration

## Incident 2026-03-07: twilio_not_configured / "we are sorry ... api key"

### Simptom

- Apelurile inbound redau mesajul audio Twilio: _"we are sorry, your call cannot be completed as dialed..."_
- `POST /api/voice/incoming` returnează `twilio_not_configured` (HTTP 500)

### Root Cause

Containerul Docker `superparty-voice` a fost pornit cu un `.env` incomplet:

| Variabilă în `.env`         | Ce ar fi trebuit                                                        |
| --------------------------- | ----------------------------------------------------------------------- |
| `TWILIO_TOKEN=...`          | `TWILIO_AUTH_TOKEN=...` ← **greșit, codul citește `TWILIO_AUTH_TOKEN`** |
| Lipsea `TWILIO_ACCOUNT_SID` | Necesar pentru `twilio(SID, TOKEN)`                                     |
| Lipsea `TWIML_APP_SID`      | Necesar pentru token VoIP generation                                    |
| Lipsea `SUPABASE_URL`       | Necesar pentru auth                                                     |

Codul din `index.js` linia 41 și 89:

```js
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;  // undefined dacă lipsește
const twilioClient = (TWILIO_SID && TWILIO_TOKEN) ? twilio(...) : null;  // null
// ...
if (!TWILIO_TOKEN) return res.status(500).send('twilio_not_configured');
```

### Verificare Rapidă

```bash
# Verifică env vars live în container
docker exec superparty-voice node -e "console.log({
  configured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
  TWIML_SET: !!(process.env.TWIML_APP_SID)
})"

# Test incoming (așteptat: missing_twilio_signature, nu twilio_not_configured)
curl -s -X POST http://localhost:3001/api/voice/incoming \
  -d "To=%2B40373805828&From=%2B40734032795&CallSid=CA_TEST"

# Health
curl -s https://voice.superparty.ro/health
```

### Fix Aplicat

```bash
# 1. Copiază .env complet în voice-build
cp /var/lib/docker/overlay2/<overlay_id>/diff/usr/src/app/.env /root/voice-build/.env

# 2. Pornire container cu env-file complet
/root/start-voice.sh
```

Sau manual:

```bash
docker stop superparty-voice && docker rm superparty-voice
docker run -d \
  --name superparty-voice \
  --restart always \
  --env-file /root/voice-build/.env \
  -p 3001:3001 \
  superparty-voice:latest
```

### Variabile obligatorii în `.env`

```
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...      ← NU TWILIO_TOKEN
TWILIO_API_KEY_SID=SK...
TWILIO_API_KEY_SECRET=...
TWIML_APP_SID=AP...        ← NU TWILIO_TWIML_APP_SID
TWILIO_PUSH_CREDENTIAL_SID=CR...
TWILIO_PHONE_NUMBER=+40...
TWILIO_CALLER_ID=+40...
SUPABASE_URL=https://...
SUPABASE_SERVICE_KEY=...
JWT_SECRET=...
PORT=3001
PUBLIC_URL=https://voice.superparty.ro
BASE_URL=https://voice.superparty.ro
```

### Script de Pornire

`/root/start-voice.sh` validează `.env` înainte de pornire și detectează greșeala `TWILIO_TOKEN` vs `TWILIO_AUTH_TOKEN`.

### Post-Fix Validation

| Test                                 | Rezultat așteptat                |
| ------------------------------------ | -------------------------------- |
| ENV `configured=true`                | ✅                               |
| Incoming fără semnătură              | `missing_twilio_signature` ✅    |
| Incoming cu semnătură Twilio         | TwiML valid (Dial/Conference) ✅ |
| `https://voice.superparty.ro/health` | `{status:"ok"}` ✅               |
