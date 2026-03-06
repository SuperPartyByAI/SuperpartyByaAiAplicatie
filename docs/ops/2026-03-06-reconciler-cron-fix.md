# OPS: wa-reconciler — eliminare cron_restart PM2

**Data:** 2026-03-06 22:35 EET  
**Context:** Audit post-sprint — identificat restart loop artificial pe wa-reconciler

---

## Problema identificată

`wa-reconciler` raporta 206+ restarts, cu uptime resetat la ~2 minute în mod constant.

**Cauza:** PM2 avea configurat `cron_restart: */5 * * * *` — repornea procesul la fiecare 5 minute, indiferent de stare. Asta intră în conflict direct cu `setInterval` din daemon mode (reconciliatorul rulează continuu intern).

```
│ cron restart │ */5 * * * * │  ← CONFLICT cu setInterval intern
│ restarts     │ 207         │  ← creștea la fiecare 5 min
```

**Nu era crash** — era restart artificial PM2.

---

## Fix aplicat live (2026-03-06)

```bash
pm2 stop wa-reconciler
pm2 delete wa-reconciler

# Restart fara cron_restart
pm2 start /root/whatsapp-integration-v6/server/whatsapp/reconciler/wa-reconciler.mjs \
  --name wa-reconciler \
  --time

pm2 save
```

**Stare după fix:**

```
│ restarts          │ 0       │
│ cron restart      │ (absent)|
│ status            │ online  │
│ uptime            │ crește  │
```

---

## Verificare că fix-ul ține

```bash
ssh root@89.167.115.150 -i ~/.ssh/antigravity_new \
  'pm2 show wa-reconciler --no-color | grep -E "status|restarts|cron"'
```

Așteptat:

- `status: online`
- `restarts: 0` (sau creșteri mici din restart natural, nu loop)
- `cron restart:` absent

---

## Actualizare ecosystem.config.js (TODO)

Dacă există un `ecosystem.config.js` pentru PM2, trebuie verificat că **nu** conține `cron_restart` pe `wa-reconciler`:

```js
// CORECT — fara cron_restart
{
  name: 'wa-reconciler',
  script: './server/whatsapp/reconciler/wa-reconciler.mjs',
  // fara: cron_restart: '*/5 * * * *'
}
```

---

## DLQ audit simultan (2026-03-06 22:35)

Reconciliatorul raporta `wa-dlq depth=4` — identificat pe `bull:wa-events:failed`.

**Cele 4 jobs:** `messages.upsert` cu FK violation `messages_conversation_id_fkey`  
**Cauza:** mesaje primite de la `40721234567@s.whatsapp.net` când conversația nu exista în Supabase  
**Acțiune:** șterse controlled (irecuperabile fără conversație)

```bash
# Cleanup executat
redis-cli zrem "bull:wa-events:failed" "msg_hQtWagPAA490T7FD3vdb_3EB09..." # x4
# Rezultat
bull:wa-events:failed: 0
bull:wa-outbox:failed: 0
```

**Urmărire viitoare:** implementare guard în `wa-worker.mjs` — upsert conversation înainte de messages insert (PR normal, nu urgent).
