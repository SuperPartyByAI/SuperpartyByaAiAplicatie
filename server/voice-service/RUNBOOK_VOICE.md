# RUNBOOK_VOICE.md — Superparty PBX Voice Service

> **Single active node required.** Voice service uses in-memory maps (`pushAckMap`, `wave2Map`).  
> Active-active is unsafe until these are moved to Redis/Supabase.

## Table of Contents

1. [Context](#0-context)
2. [Health Checks](#1-health-checks)
3. [Deploy Standard](#2-deploy-standard)
4. [Rollback](#3-rollback)
5. [Failover Centrala → voice-2](#4-failover)
6. [Smoke Tests](#5-smoke-tests)
7. [Debug / Observability](#6-debug--observability)
8. [Alerts](#7-alerts)
9. [Production Checklist](#8-production-checklist)

---

## 0. Context

| Nod                       | Rol        | URL                                   |
| ------------------------- | ---------- | ------------------------------------- |
| Centrala (`91.98.16.90`)  | **ACTIVE** | `voice.superparty.ro` → LB → Centrala |
| voice-2 (`46.225.217.36`) | Standby    | Activat prin LB failover              |
| voice-dr                  | DR         | Doar după TLS corect                  |

**End-to-end flow:**

```
PSTN → Twilio → /api/voice/incoming
     → TwiML conf_<CallSid> (hold music)
     → Fan-out: candidates = WS-online OR valid FCM (exclude WS_ONLY offline)
     → Wave-1: top 3 → ACK wait (ACK_WAIT_MS=7000ms, TTL=15m)
     → Winner → CANCEL_RINGING_UI → Wave-1 reste + Wave-2 (dacă declanșat)
     → Device: directPlace → Voice.connect → conf_<CallSid> → audio live
```

---

## 1. Health Checks

```bash
# Extern
curl -fsS https://voice.superparty.ro/health
# Așteptat: {"status":"ok","service":"voice-service"}

# Intern (pe server)
curl -fsS http://127.0.0.1:3001/health
docker ps | grep superparty-voice
docker logs --tail 200 superparty-voice

# Validare endpoint ACK (trebuie 400)
curl -i -X POST https://voice.superparty.ro/api/voice/push-ack \
  -H 'Content-Type: application/json' -d '{}'
# Așteptat: 400 {"error":"missing_params"}

# WS connectivity
curl -fsS https://voice.superparty.ro/api/voice/push-ack/status 2>/dev/null || \
  echo "WS status endpoint not exposed — check docker logs"
```

---

## 2. Deploy Standard

> **Presupunere:** Codul e montat via bind-mount din `/var/www/Superparty-App/server/voice-service/`.

```bash
# Pe nodul activ (Centrala)
cd /var/www/Superparty-App
git fetch --all && git pull origin main

# Copiază + restart (dacă nu există docker build pipeline)
docker restart superparty-voice
sleep 3
docker logs --tail 30 superparty-voice
curl -fsS http://127.0.0.1:3001/health
```

### `.env` — variabile obligatorii

```dotenv
PUBLIC_URL=https://voice.superparty.ro
JWT_SECRET=<secret>
ACK_WAIT_MS=7000
ACK_TOKEN_TTL=15m

# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_API_KEY_SID=
TWILIO_API_KEY_SECRET=
TWIML_APP_SID=
TWILIO_CALLER_ID=

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
```

> `gpt-firebase-key.json` trebuie să fie prezent în working dir-ul containerului.

---

## 3. Rollback

### Variantă A — git rollback + restart

```bash
cd /var/www/Superparty-App
git log --oneline -10            # găsești SHA bun
git checkout <SHA_bun>
docker restart superparty-voice
curl -fsS http://127.0.0.1:3001/health
```

### Variantă B — imagine versionată (recomandat pentru viitor)

```bash
# în docker-compose.yml: image: superparty-voice:<gitsha>
docker compose pull
docker compose up -d --force-recreate
```

---

## 4. Failover

**Condiție:** voice-2 are aceeași versiune deployată și `/health` OK.

```bash
# Pe voice-2: verifică că e ok
ssh root@46.225.217.36 "curl -fsS http://127.0.0.1:3001/health"

# Schimbă target activ în Hetzner LB (sau DNS)
# Hetzner Cloud Console → Load Balancers → voice.superparty.ro
# Dezactivezi Centrala, activezi voice-2

# Verificare externă
curl -fsS https://voice.superparty.ro/health
```

> ⚠️ După failover, registry-ul in-memory se repopulează din Supabase automat la startup.

---

## 5. Smoke Tests (după orice deploy)

### A) Inbound PSTN foreground

1. Sună numărul Twilio de pe alt telefon
2. Răspunde cu app-ul deschis
3. Verifică audio (ambele capete)
4. Așteptat în logs:
   ```
   [PBX Twilio] Incoming Call Webhook Fired
   [PBX ACK] Received push-ack for CA... from user_...
   [PBX] Call CA... WON by user_... Canceling others.
   [PBX Twilio] Dial Status Webhook / Master Call Status Webhook
   ```

### B) Huawei background (ecran blocat)

1. Blochează ecranul Huawei
2. Sună numărul Twilio
3. Răspunde din notificare / lockscreen
4. Verifică: fără SIGABRT în `adb logcat -b crash -d`

### C) Multidevice cancel

1. 2 device-uri logated cu același user
2. Sună → ambele sună
3. Răspunde pe device 1
4. Device 2 trebuie să primească `CANCEL_RINGING_UI` și să oprească ringing
5. Verifică în logs: `Canceling others.`

---

## 6. Debug / Observability

### Loguri pe CallSid specific

```bash
CALLSID="CAxxxxxxxx"
docker logs --since 30m superparty-voice | \
  egrep "$CALLSID|Incoming Call Webhook Fired|PBX ACK|WON by|Wave-2|CANCEL_RINGING_UI|Dial Status|Master Call Status|OUTBOUND conference join|Incoming webhook error"
```

### Dispozitive înregistrate

```bash
docker logs --since 1m superparty-voice | grep "VoIP DB"
# [VoIP DB] Loaded XX device(s) into registry
```

### Indicatori de sănătate (din loguri)

| Semnal                       | Normal        | Acțiune dacă anormal                                          |
| ---------------------------- | ------------- | ------------------------------------------------------------- |
| `UNREGISTERED` count         | Scade în timp | Verifică DB cleanup automat (WS_ONLY)                         |
| `late/expired ACK`           | Rar           | Crește `ACK_WAIT_MS` la 9000 dacă Huawei                      |
| `Wave-2` frecvent            | Ocazional     | Top-3 include device-uri offline → verifică filtrul WS-online |
| `Incoming webhook error`     | Niciodată     | Verifică TWILIO_AUTH_TOKEN + signature                        |
| `No VoIP clients registered` | Niciodată     | Verifică DB + în-memorie registry                             |

---

## 7. Alerts (recomandat)

### Uptime Kuma / Pingdom (minim)

| Monitor      | URL                                      | Condiție                         |
| ------------ | ---------------------------------------- | -------------------------------- |
| Health       | `GET https://voice.superparty.ro/health` | Status 200 + body conține `"ok"` |
| ACK endpoint | `POST /api/voice/push-ack` cu `{}`       | Status 400 (nu 500)              |

### Alerte pe loguri (opțional — Grafana/Loki sau grep cron)

```bash
# Cron la fiecare 5 min — alertă dacă apar erori critice
docker logs --since 5m superparty-voice | \
  grep -E "Incoming webhook error|twilio_signature_error|FATAL" && \
  echo "ALERT: Voice PBX error in last 5m"
```

---

## 8. Production Checklist

- [ ] LB/DNS: **un singur target activ** (`voice.superparty.ro` → Centrala)
- [ ] `/health` OK extern (`https://`) și intern (`http://127.0.0.1:3001`)
- [ ] Smoke test A (PSTN foreground) ✅
- [ ] Smoke test B (Huawei background / lockscreen) ✅
- [ ] Smoke test C (multidevice cancel) ✅
- [ ] Android: `-dontshrink` activ în `proguard-rules.pro` (stabilitate Twilio JNI)
- [ ] `ACK_TOKEN_TTL=15m` în `.env`
- [ ] `ACK_WAIT_MS=7000` (sau 9000 pt. Huawei lent) în `.env`
- [ ] FCM UNREGISTERED cleanup automat activ
- [ ] Wave-2 cancel activ (nu rămân device-uri în "ringing" după winner)
- [ ] `gpt-firebase-key.json` prezent în container
- [ ] Uptime monitor configurat pe `/health`

---

_Generat: 2026-03-06. Actualizat la fiecare schimbare majoră de arhitectură PBX._
