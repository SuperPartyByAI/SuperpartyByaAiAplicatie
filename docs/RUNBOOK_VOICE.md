# Deploy Voice — Runbook

## Superparty V6 — voice.superparty.ro (VPS: 91.98.16.90)

### Arhitectură curentă

```
[Twilio] → [nginx :443] → [Node.js :3001 /root/voice-build/index.js]
                              ↓
                         [Redis :6379] — active_calls_idx ZSET
                              ↓
                         [Supabase] — device_tokens, sessions
```

- **Dependințe critice:** Redis, Supabase, Twilio webhooks, Firebase FCM
- **Process manager:** nohup node (fără pm2 pe voice VPS)
- **Restart:** kill -SIGTERM + nohup node sau docker restart

---

### Env vars necesare (`/root/voice-build/.env`)

```bash
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
TWILIO_SID=
TWILIO_TOKEN=
TWILIO_API_KEY_SID=
TWILIO_API_KEY_SECRET=
TWIML_APP_SID=
PUSH_CREDENTIAL_SID=
ADMIN_TOKEN=
WS_JWT_SECRET=
PUBLIC_URL=https://voice.superparty.ro
TWILIO_CALLER_ID=
TWILIO_PHONE_NUMBER=
REDIS_URL=redis://127.0.0.1:6379
NODE_ENV=production
PORT=3001
```

---

### Deploy Standard

```bash
# De pe mașina locală sau CI
cd /path/to/repo
bash scripts/deploy_voice.sh

# Sau manual:
scp -i ~/.ssh/antigravity_new server/voice/index.js root@91.98.16.90:/root/voice-build/index.js

ssh root@91.98.16.90 -i ~/.ssh/antigravity_new << 'EOF'
cd /root/voice-build
# Verify patch present
grep -q "pruneStaleZsetMembers" index.js && echo "✅ ZSET prune" || exit 1

# Graceful restart
NODE=$(find /usr/local/bin /usr/bin -name "node" -maxdepth 2 | head -1)
kill -SIGTERM $(pgrep -f "node.*index.js" | head -1) 2>/dev/null; sleep 3
nohup $NODE index.js >> /var/log/voice-server.log 2>&1 &
echo "Started PID=$!"
sleep 5
tail -5 /var/log/voice-server.log
EOF
```

### Post-Deploy Smoke

```bash
# Health check
curl -s https://voice.superparty.ro/health     # expect {"status":"ok"}
# Active calls (requires auth)
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" https://voice.superparty.ro/api/voice/active-calls
# Metrics
curl -s https://voice.superparty.ro/metrics | head -10
```

---

### Rollback

```bash
# Rollback la SHA anterior (ex: 866732d)
git checkout -f 866732d -- server/voice/index.js
bash scripts/deploy_voice.sh
```

---

### Diagnostics

**Logs:**

```bash
ssh root@91.98.16.90 -i ~/.ssh/antigravity_new
tail -f /var/log/voice-server.log
```

**Redis active calls:**

```bash
redis-cli ZRANGE active_calls_idx 0 -1 WITHSCORES
redis-cli KEYS "active_call:*"
```

**Procese rulând:**

```bash
ps aux | grep "node index.js"
```

---

### Incidente Tipice

#### Redis unavailable

```
Simptom: [Redis] Error: ECONNREFUSED
Acțiune:
  redis-cli ping
  systemctl restart redis
  # Voice continuă cu fallback (in-memory degradat)
```

#### Voice server crashed

```
Simptom: curl health → connection refused
Acțiune:
  ps aux | grep node
  cd /root/voice-build && nohup node index.js >> /var/log/voice-server.log 2>&1 &
  tail -20 /var/log/voice-server.log  # caută eroarea
```

#### Stale ringing / UI blocat

```
Simptom: app arată apel incoming care nu mai există
Acțiune:
  redis-cli ZRANGE active_calls_idx 0 -1
  redis-cli DEL active_call:<callSid>
  redis-cli ZREM active_calls_idx <callSid>
  # Client: reconnect WS → reconcile automat
```

#### Twilio webhook fail

```
Simptom: apeluri nu ajung, Twilio error 11200
Acțiune:
  curl -X POST https://voice.superparty.ro/api/voice/incoming  # test manual
  nginx error log: tail -f /var/log/nginx/error.log
  verifică ngrok tunnel dacă în dev
```
