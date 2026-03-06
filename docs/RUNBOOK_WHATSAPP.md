# Deploy WhatsApp — Runbook

## Superparty V6 — wa.superparty.ro (VPS: 89.167.115.150)

### Arhitectură curentă

```
[Client Flutter]
      ↓
[nginx :443 wa.superparty.ro]
      ↓
[whatsapp-integration-v6-index.js :3001]   ← pm2
      ↓                        ↓
[Baileys WA session]    [wa-outbox-api.mjs]
                               ↓
                    [outbox_messages Supabase]
                               ↓
                    [wa-outbox-worker.mjs]   ← pm2 separat
                               ↓
                    [POST /api/wa/send-direct]  ← WA_INTERNAL_TOKEN
                               ↓
                    [Baileys sock.sendMessage]
```

**Procese pm2 pe WA VPS:**
| Nume | Script | Port |
|---|---|---|
| whatsapp-integration-v6 | whatsapp-integration-v6-index.js | 3001 |
| wa-outbox-worker | server/whatsapp/workers/wa-outbox-worker.mjs | — |
| wa-reconciler | wa-reconciler.mjs | — |

---

### Env vars necesare (`/root/whatsapp-integration-v6/.env`)

```bash
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
WA_INTERNAL_TOKEN=          # token intern worker → server, openssl rand -hex 32
WHATSAPP_API_URL=http://localhost:3001
OUTBOX_POLL_MS=2000
OUTBOX_BATCH_SIZE=10
OUTBOX_MAX_ATTEMPTS=5
NODE_ENV=production
PORT=3001
```

---

### Deploy Standard

```bash
# Script oficial (de pe mașina locală sau CI)
bash scripts/deploy_wa.sh

# Sau manual pe VPS:
ssh root@89.167.115.150 -i ~/.ssh/antigravity_new << 'EOF'
cd /root/whatsapp-integration-v6
git fetch origin main --depth=1
git checkout -f origin/main -- \
  whatsapp-integration-v6-index.js \
  server/whatsapp/workers/wa-outbox-api.mjs \
  server/whatsapp/workers/wa-outbox-worker.mjs

# Verify patches
grep -q "wa/send-direct" whatsapp-integration-v6-index.js && echo "✅ exempt" || exit 1
grep -q "registerOutboxRoutes" whatsapp-integration-v6-index.js && echo "✅ outbox routes" || exit 1

# Reload graceful (no session drop)
pm2 reload whatsapp-integration-v6 --update-env
pm2 reload wa-outbox-worker --update-env
sleep 5
pm2 list | grep -E "wa-outbox|whatsapp"
EOF
```

> ⚠️ Folosește `pm2 reload` (graceful), NU `pm2 restart` — reload păstrează sesiunile WS active

### Post-Deploy Smoke

```bash
# Health
curl -s https://wa.superparty.ro/health                    # {"status":"ok"}

# Auth boundary send-direct
curl -s -o /dev/null -w "%{http_code}" -X POST \
  https://wa.superparty.ro/api/wa/send-direct              # 403

# Outbox enqueue test (cu Firebase token)
curl -s -X POST https://wa.superparty.ro/api/wa/outbox/send \
  -H "Authorization: Bearer $FB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"accountId":"test","to":"40700@s.whatsapp.net","text":"smoke"}'

# Worker metrics (Supabase)
curl "$SUPABASE_URL/rest/v1/outbox_worker_metrics?select=*" \
  -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
```

---

### Rollback

```bash
# Rollback la SHA anterior
bash scripts/deploy_wa.sh 0bc16e7

# Sau manual:
ssh root@89.167.115.150 -i ~/.ssh/antigravity_new
git checkout -f 0bc16e7 -- whatsapp-integration-v6-index.js \
  server/whatsapp/workers/wa-outbox-api.mjs
pm2 reload whatsapp-integration-v6 --update-env
```

---

### Diagnostics

**Logs live:**

```bash
pm2 logs whatsapp-integration-v6 --lines 50
pm2 logs wa-outbox-worker --lines 30
```

**Outbox queue depth:**

```bash
curl "$SUPABASE_URL/rest/v1/outbox_messages?status=eq.queued&select=count" \
  -H "apikey: $KEY"
```

**DLQ (dead messages):**

```bash
curl "$SUPABASE_URL/rest/v1/outbox_messages?status=eq.dead&select=*" \
  -H "apikey: $KEY"
```

**Worker status:**

```bash
pm2 describe wa-outbox-worker | grep -E "status|restarts|uptime"
```

**WA session status:**

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3001/api/wa/status
```

---

### Incidente Tipice

#### Worker offline

```
Simptom: outbox_worker_metrics.sent stagnează + queue crește
Acțiune:
  pm2 status wa-outbox-worker
  pm2 start wa-outbox-worker
  pm2 logs wa-outbox-worker --lines 30  # caută eroarea
```

#### DLQ > 0 (dead messages)

```
Simptom: outbox_messages cu status=dead
Acțiune:
  # Verificare
  GET /debug/outbox/dlq (cu Firebase auth)

  # Replay DLQ
  POST /debug/outbox/replay (cu Firebase auth)

  # Sau Supabase direct:
  UPDATE outbox_messages SET status='queued', attempts=0, error_message=null
  WHERE status='dead'
```

#### Outbox stuck (queued nu scade)

```
Simptom: queue_queued > 0 și nu scade 15+ minute
Acțiune:
  1. pm2 status wa-outbox-worker  → dacă offline: pm2 start
  2. verifică WA_INTERNAL_TOKEN în .env
  3. curl -X POST localhost:3001/api/wa/send-direct \
       -H "Authorization: Bearer $WA_INTERNAL_TOKEN" \
       -H "Content-Type: application/json" \
       -d '{"accountId":"x","to":"y@s.whatsapp.net","text":"test"}'
  4. dacă 403 → WA_INTERNAL_TOKEN greșit în worker vs server
  5. dacă Baileys error → verifică sesiune WA
```

#### WA Session Reconnect (QR / auth)

```
Simptom: Baileys "Connection Closed" sau QR cerut din nou
Acțiune:
  1. pm2 logs whatsapp-integration-v6 | grep "connection"
  2. Dacă session invalidată: re-link via QR la /api/wa/qr/{accountId}
  3. auth_info_multi/ este pe VPS — nu se pierde la pm2 reload
  4. dacă QR expiră: GET /api/wa/qr/{accountId} din nou
```

#### send-direct returnează 403 (worker nu poate trimite)

```
Simptom: worker logs "WA API 403"
Acțiune:
  grep "WA_INTERNAL_TOKEN" /root/whatsapp-integration-v6/.env
  # Compară cu cel din server — trebue identic
  pm2 restart wa-outbox-worker --update-env
```
