# Release Checklist — Superparty V6

## Flux obligatoriu: PR → CI → Deploy → Smoke → Rollback

---

## A. Pre-Deploy (înainte de orice schimbare)

```bash
# 1. Verify zero drift
ssh root@89.167.115.150 -i ~/.ssh/antigravity_new '
  cd /root/whatsapp-integration-v6
  git fetch origin main --depth=1
  git diff origin/main -- whatsapp-integration-v6-index.js | wc -l
  # Trebuie: 0 linii diff
'

# 2. Outbox queue gol
curl "$SUPABASE_URL/rest/v1/outbox_messages?status=eq.queued&select=count" \
  -H "apikey: $KEY"  # Așteptat: 0

# 3. DLQ = 0
curl "$SUPABASE_URL/rest/v1/outbox_messages?status=eq.dead&select=count" \
  -H "apikey: $KEY"  # Așteptat: 0

# 4. CI verde pe SHA curent
open https://github.com/SuperPartyByAI/SuperpartyByaAiAplicatie/actions
```

---

## B. Upgrade WhatsApp/Baileys — Checklist Pre-Deploy

- [ ] `git status` local: clean
- [ ] Versiunea nouă testată în dev (nu direct pe prod)
- [ ] Outbox queue fluent (nu blocată)
- [ ] WA sesiune stabilă (nu în mijlocul unui reconnect)
- [ ] SHA curent notat: `git rev-parse HEAD`
- [ ] Backup `.env`: `cp .env .env.backup.$(date +%s)`
- [ ] Syntax check: `node --check whatsapp-integration-v6-index.js`

---

## C. Deploy WA (Procedura Oficială)

```bash
# De pe mașina locală
bash scripts/deploy_wa.sh

# Deploy la SHA specific
bash scripts/deploy_wa.sh 60401b4

# Verificare manuală post-deploy
pm2 list
curl -s https://wa.superparty.ro/health
```

**Validat automat de deploy_wa.sh:**

- `exempt /wa/send-direct` prezent
- `registerOutboxRoutes` prezent
- `persistMetrics` în worker
- pm2 reload WA + worker
- health check http 200
- send-direct 403 fără token

---

## D. Deploy Voice (Procedura Oficială)

```bash
# De pe mașina locală (v2 — git, fără scp)
bash scripts/deploy_voice.sh

# Deploy la SHA specific
bash scripts/deploy_voice.sh 60401b4
```

**Validat automat de deploy_voice.sh:**

- git fetch + checkout din repo
- `pruneStaleZsetMembers` prezent
- `setActiveCall` prezent (nu activeCallsMap.set)
- Docker container restart
- health check 200

---

## E. Smoke Tests Post-Deploy (Obligatoriu)

```bash
# WA
curl -s https://wa.superparty.ro/health | python3 -c "import sys,json;print(json.load(sys.stdin)['status'])"
# Așteptat: ok

# Voice
curl -s https://voice.superparty.ro/health
# Așteptat: {"status":"ok","service":"voice-service"}

# CI smoke (trigger manual)
# https://github.com/SuperPartyByAI/SuperpartyByaAiAplicatie/actions
# → Run workflow → CI — Smoke Tests
```

---

## F. Rollback (Dacă Smoke Fail)

```bash
# WA rollback la SHA anterior (ex: 60401b4)
bash scripts/deploy_wa.sh 60401b4

# Voice rollback
bash scripts/deploy_voice.sh 60401b4
```

**Rollback criteria (trigger imediat):**

- Health fail după deploy
- DLQ crește imediat post-deploy
- send-direct returnează altceva decât 403 fără token
- Voice health fail
- pm2 wa-outbox-worker stopped imediat după start

---

## G. Flux PR → CI → Deploy → Smoke

```
1. Deschide PR pe GitHub
   └── CI rulează automat (push/pr trigger)
   └── Verifici: 3/3 jobs verzi (outbox, voice, lint)

2. Merge PR (numai dacă CI = verde)

3. Deploy pe WA VPS
   └── bash scripts/deploy_wa.sh

4. Deploy pe Voice VPS (dacă schimbări în server/voice/)
   └── bash scripts/deploy_voice.sh

5. Smoke manual (30 sec)
   └── WA health + Voice health + DLQ = 0

6. Dacă ceva fail: rollback imediat
   └── bash scripts/deploy_wa.sh <SHA_anterior>
```

---

## H. Upgrade-Safe Matrix — Teste Obligatorii

| Scenariu           | Test                         | Așteptat        |
| ------------------ | ---------------------------- | --------------- |
| WA outbound        | enqueue → worker → sent      | status=sent     |
| WA idempotency     | același idempotency_key      | null (no dup)   |
| WA DLQ             | forțează fail × 5            | status=dead     |
| WA replay          | POST /debug/outbox/replay    | status=queued   |
| Voice incoming     | Twilio POST /incoming        | TwiML valid     |
| Voice active calls | GET /api/voice/active-calls  | [] sau array    |
| Voice Redis        | redis-cli ping               | PONG            |
| Voice Docker       | curl health                  | {"status":"ok"} |
| Worker restart     | pm2 restart wa-outbox-worker | online în 5s    |
| CI verde           | GitHub Actions               | 3/3 PASS        |

---

_Ultima actualizare: 2026-03-06 — Sprint Final Hardening_
