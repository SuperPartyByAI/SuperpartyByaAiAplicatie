# WhatsApp Enterprise Backend — Runbook

## Server: 89.167.115.150 (Hetzner CPX42) | Domain: wa.superparty.ro

---

## Architecture (prod)

```
Flutter App ──HTTPS──> Nginx (wa.superparty.ro:443)
                           │
                     ┌─────▼──────────────────────────┐
                     │     Node.js :3001 (pm2)         │
                     │  whatsapp-integration-v6         │
                     │                                  │
                     │  wa-api + wa-session-manager     │
                     │  (monolith — Baileys + Express)  │
                     └─────┬──────────────┬─────────────┘
                           │ enqueue      │ read
                      ┌────▼────┐    ┌────▼────┐
                      │  Redis  │    │Supabase  │
                      │  +AOF   │    │  (PG)   │
                      └────┬────┘    └─────────┘
                           │ consume
                     ┌─────▼────────┐
                     │  wa-worker   │ (pm2 id=1)
                     │  BullMQ      │ write messages/convos
                     └─────────────┘
                     wa-reconciler   (pm2 id=3, cron 5min)
```

---

## pm2 Processes

| id  | name                      | role                                             |
| --- | ------------------------- | ------------------------------------------------ |
| 0   | `whatsapp-integration-v6` | Baileys sessions + Express API                   |
| 1   | `wa-worker`               | BullMQ consumer → Supabase writer                |
| 3   | `wa-reconciler`           | Watchdog cron (5min): queue depth, DLQ, sessions |

```bash
# Check status
pm2 ls
pm2 logs wa-worker --lines 50
pm2 logs wa-reconciler --lines 20
```

---

## Queue System (BullMQ + Redis)

| Queue       | Purpose                         | Attempts | Backoff        |
| ----------- | ------------------------------- | -------- | -------------- |
| `wa-events` | messages.upsert / update events | 12       | exponential 5s |
| `wa-media`  | media download + upload         | 5        | exponential    |
| `wa-dlq`    | exhausted jobs (DLQ)            | —        | manual replay  |

### Key endpoints (all require `?token=ADMIN_TOKEN`)

```
GET  https://wa.superparty.ro/debug/queue-stats       — queue depths
GET  https://wa.superparty.ro/debug/dlq               — list failed jobs
POST https://wa.superparty.ro/debug/dlq/replay?id=... — replay a DLQ job
GET  https://wa.superparty.ro/debug/recent-messages   — last DB writes
```

---

## Durability Gates (validated 2026-03-06)

| Gate   | Test                                                       | Result         |
| ------ | ---------------------------------------------------------- | -------------- |
| A      | 10k mock events → 0 loss, DLQ=0                            | ✅ PASS (118s) |
| B-env  | env corrupt → 200/200 after restore                        | ✅ PASS        |
| B-Real | iptables DROP Supabase → 150 held → 150/150 recovery in 6s | ✅ PASS        |
| C      | pm2 restart mid-backlog → 300/300 survives                 | ✅ PASS        |

---

## Routine Operations

### Deploy update

```bash
ssh root@89.167.115.150
cd /root/whatsapp-integration-v6
# edit files or git pull from your branch
pm2 restart whatsapp-integration-v6 --update-env
pm2 restart wa-worker
pm2 save
```

### Smoke test

```bash
ADMIN_TOKEN=<token> WA_BASE=https://wa.superparty.ro ./ops/whatsapp/smoke_whatsapp.sh
```

### Check queue health

```bash
curl "https://wa.superparty.ro/debug/queue-stats?token=ADMIN_TOKEN"
# Expected: all depths = 0 during normal operation
```

### Replay DLQ job

```bash
# 1. List DLQ
curl "https://wa.superparty.ro/debug/dlq?token=ADMIN_TOKEN"
# 2. Replay specific job
curl -X POST "https://wa.superparty.ro/debug/dlq/replay?id=JOB_ID&token=ADMIN_TOKEN"
```

---

## Backup

### auth_info (WhatsApp sessions)

- **Location:** `/root/whatsapp-integration-v6/auth_info/<accountId>/`
- **Backup:** daily at 03:00 UTC → `/root/backups/auth_info_YYYYMMDD.tar.gz`
- **Retention:** 30 days
- **Cron:** `0 3 * * * tar -czf /root/backups/auth_info_$(date +\%Y\%m\%d).tar.gz ... -mtime +30 -delete`

### Restore from backup

```bash
BACKUP=/root/backups/auth_info_20260306.tar.gz
mkdir -p /tmp/restore_test
tar -xzf $BACKUP -C /tmp/restore_test
# Verify contents
ls /tmp/restore_test/root/whatsapp-integration-v6/auth_info/
# Restore to production (careful!)
# cp -r /tmp/restore_test/root/whatsapp-integration-v6/auth_info/* /root/whatsapp-integration-v6/auth_info/
# pm2 restart whatsapp-integration-v6
```

---

## Redis AOF Config

```
bind 127.0.0.1
protected-mode yes
appendonly yes
appendfsync everysec
```

Verify: `redis-cli INFO persistence | grep -E 'aof_enabled|aof_last_write_status'`
Expected: `aof_enabled:1` + `aof_last_write_status:ok`

---

## Incident Playbook

### DB (Supabase) down

1. **Do nothing with Baileys** — queue retains events in Redis AOF
2. Monitor: `curl /debug/queue-stats` — depth will grow
3. When DB recovers, worker drains automatically
4. Verify: `curl /debug/recent-messages` shows new entries

### Worker not draining

```bash
pm2 logs wa-worker --lines 100  # check errors
pm2 restart wa-worker
curl /debug/queue-stats         # verify depth decreasing
```

### Account logged out

```bash
# In app: WA Accounts → select account → scan QR
# Or check state:
curl -H "Authorization: Bearer FIREBASE_TOKEN" https://wa.superparty.ro/api/wa-accounts
```

### DLQ not empty

```bash
curl "https://wa.superparty.ro/debug/dlq?token=ADMIN_TOKEN"
# Investigate error in job data
# After fix, replay:
curl -X POST "https://wa.superparty.ro/debug/dlq/replay?id=JOB_ID&token=ADMIN_TOKEN"
```

---

## Security

| Endpoint    | Protection                      |
| ----------- | ------------------------------- |
| `/api/*`    | Firebase ID token (Bearer)      |
| `/metrics`  | ADMIN_TOKEN query param         |
| `/debug/*`  | ADMIN_TOKEN query param         |
| `/health`   | Public                          |
| Port 3001   | Blocked externally (iptables)   |
| Redis :6379 | Localhost only (bind 127.0.0.1) |

---

## Scale-up Plan (accounts)

Connect gradually with validation at each step:

1. 1 account → 24h → inbound/outbound + restart test
2. 3 accounts → same tests
3. 10 accounts → same tests + queue depth monitoring
4. 20 accounts → production
