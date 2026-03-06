# RELEASE CHECKLIST — Superparty Platform

> Versiune: v2 — Post Enterprise Sprint (Mar 2026)
> Scor: Voice 8.5/10 · WA 9/10 · Platforma 9/10
> Regula de aur: **branch → PR → CI verde → pre-check → deploy script → smoke → rollback (dacă e nevoie) → monitorizare 24h**

---

## ❌ CÂND NU DEPLOYEZI

- [ ] CI nu e verde pe toate 3 checks
- [ ] Există drift live vs git
- [ ] DLQ > 0 și nu știi de ce
- [ ] Worker instabil sau offline
- [ ] Redis are probleme
- [ ] Voice sau WA `/health` nu sunt `ok`
- [ ] Există incident activ
- [ ] Nu știi rollback-ul exact

---

## PAS 1 — Branch separat (nu direct pe main)

```bash
git checkout -b fix/descriere-scurta   # sau feat/ sau ops/
```

- Nimic nu merge direct pe `main`
- Înlocuiește complet practica de "patch live pe VPS"

---

## PAS 2 — Pre-PR check local (obligatoriu)

```bash
git status                            # curat? niciun fișier uitat?
git diff main -- .                    # ce ai schimbat exact?
node --check <fisier_modificat>.mjs   # syntax ok?
grep -r "hardcoded-secret" .          # fara secrete noi?
```

Dacă atingi voice sau WA → verifici că schimbarea nu ocolește `outbox`, `auth`, `reconcile` sau `setActiveCall`.

---

## PAS 3 — PR cu impact documentat

Câmpuri obligatorii în descrierea PR:

- **Ce am schimbat:** (fișiere, logică)
- **Ce componente ating:** (voice / WA / CI / infra)
- **Risc:** (poate afecta X?)
- **Smoke post-deploy:** (ce testez explicit)
- **Rollback:** (SHA anterior, comanda exactă)

---

## PAS 4 — CI verde obligatoriu (toate 3 checks)

| Check                                | Job Name     |
| ------------------------------------ | ------------ |
| ✅ WA Outbox Validation (7 scenarii) | smoke-outbox |
| ✅ Voice Endpoints Smoke             | smoke-voice  |
| ✅ JS Syntax Check                   | lint-check   |

**Branch protection activă pe main** — merge blocat dacă orice check pică.  
Niciodată nu forțezi merge pentru "că pare ok".

---

## PAS 5 — Pre-release gate (înainte de merge)

```bash
curl -sf https://wa.superparty.ro/health      # {"status":"ok"}
curl -sf https://voice.superparty.ro/health   # {"status":"ok"}
# pe WA VPS:
pm2 list | grep -E "online"                   # worker + reconciler online
# DLQ = 0:
curl .../outbox_messages?status=eq.dead | python3 -c "..."
```

Dacă oricare e roșu → **nu deployezi**.

---

## PAS 6 — Deploy prin scriptul oficial (nu manual)

**WA:**

```bash
bash scripts/deploy_wa.sh
```

**Voice:**

```bash
bash scripts/deploy_voice.sh
```

❌ Nu `scp`, nu `nano pe VPS`, nu copiere manuală de fișiere.  
✅ Cod tras din git, restart controlat, verificări automate.

---

## PAS 7 — Smoke obligatoriu imediat după deploy

```bash
# Health
curl -sf https://wa.superparty.ro/health
curl -sf https://voice.superparty.ro/health

# WA fundamentals
# pe WA VPS:
pm2 list
pm2 logs wa-outbox-worker --lines 10 --nostream | grep -E "Metrics|FAIL"

# Voice
docker ps | grep superparty
curl -sf http://localhost:3001/health
```

**Dacă release-ul a atins WhatsApp:**

- ✅ Test enqueue mesaj: `curl -X POST .../api/wa/send` (prin outbox)
- ✅ Worker îl procesează și marchează `sent`
- ✅ DLQ rămâne 0

**Dacă release-ul a atins Voice:**

- ✅ Incoming call flow (simulat sau real)
- ✅ Active call state în Redis: `redis-cli KEYS "active_call:*"`
- ✅ Reconcile rulat ok în logs

---

## PAS 8 — Rollback imediat dacă smoke cade

```bash
# Voice rollback
ssh root@91.98.16.90
cd /root/voice-repo
git fetch origin main
git checkout -f <SHA_ANTERIOR> -- server/voice/
cd server/voice && docker build -t superparty-voice:rollback .
docker stop superparty-voice && docker rm superparty-voice
docker run -d --name superparty-voice --network superparty-network \
  --env-file /root/voice-build/.env \
  -e REDIS_URL=redis://superparty-redis:6379 -e PORT=3001 \
  -p 127.0.0.1:3001:3001 --restart unless-stopped superparty-voice:rollback

# WA rollback
ssh root@89.167.115.150
cd /root/whatsapp-integration-v6
git checkout <SHA_ANTERIOR> -- whatsapp-integration-v6-index.js
pm2 reload whatsapp-integration-v6
```

Triggeri rollback imediat:

- health cade
- worker moare sau nu procesează
- outbox accumulează erori
- send-direct fără boundary
- voice incoming se rupe
- apar alerte reale

---

## PAS 9 — Log post-release (obligatoriu)

```markdown
**Release YYYY-MM-DD HH:MM**

- SHA: <git-sha>
- Deploy: WA / Voice / Ambele
- Schimbări: <descriere scurtă>
- CI: ✅ verde (#run_number)
- Smoke: ✅ passed / ❌ rollback la <SHA>
- Alerte ntfy: da/nu
- Incidente: da/nu
```

---

## PAS 10 — Stabilitate post-release (30min, 2h, 24h)

| Moment  | Ce verifici                                           |
| ------- | ----------------------------------------------------- |
| +30 min | health, worker online, DLQ=0, queue depth normal      |
| +2h     | metrics, reconciler ok, Redis AOF ok, log-uri curate  |
| +24h    | 0 alerte ntfy, 0 incidente utilizatori, worker stable |

---

## ROLLBACK RAPID (referință)

| Situație             | Comandă                                                 |
| -------------------- | ------------------------------------------------------- |
| Voice cade           | `docker stop/rm; docker run cu SHA anterior`            |
| WA cade              | `git checkout SHA -- index.js; pm2 reload`              |
| Worker cade          | `pm2 restart wa-outbox-worker`                          |
| Reconciler crasheaza | `pm2 restart wa-reconciler`                             |
| Redis pierdut        | `docker restart superparty-redis` (AOF restore automat) |

---

## CI STATUS ACTUAL

| Check                 | Branch protection | Ultima rulare |
| --------------------- | ----------------- | ------------- |
| WA Outbox Validation  | ✅ obligatoriu    | Run #14 ✅    |
| Voice Endpoints Smoke | ✅ obligatoriu    | Run #14 ✅    |
| JS Syntax Check       | ✅ obligatoriu    | Run #14 ✅    |

---

## BACKLOG PENTRU 10/10

1. **CI pe Supabase separat de prod** — creare Supabase project free tier + secret `CI_SUPABASE_URL`
2. **Alerting: confirmare incident real** — nu doar test; ntfy trebuie să prindă un case real detectat automat
3. **Stabilitate demonstrată în timp** — 3 release-uri reale, complete, fără incidente

> _"Nu mai construiți sistemul prin intervenții live, ci prin release-uri disciplinate."_
