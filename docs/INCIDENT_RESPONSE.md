# Incident Response — Superparty V6

## Voice + WhatsApp — Single-Node Production

---

## 0. Contact rapid

| Sistem     | VPS                                                                | IP                                                          |
| ---------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| WA backend | 89.167.115.150                                                     | `ssh root@89.167.115.150 -i ~/.ssh/antigravity_new`         |
| Voice/PBX  | 91.98.16.90                                                        | `ssh root@91.98.16.90 -i ~/.ssh/antigravity_new`            |
| Supabase   | ilkphpidhuytucxlglqi                                               | https://supabase.com/dashboard/project/ilkphpidhuytucxlglqi |
| GitHub     | [repo](https://github.com/SuperPartyByAI/SuperpartyByaAiAplicatie) |                                                             |

---

## 1. Worker Offline (WA)

**Simptom:** mesaje rămân în `status=queued` și nu se trimit, `outbox_worker_metrics.polls` nu crește

```bash
ssh root@89.167.115.150 -i ~/.ssh/antigravity_new
pm2 describe wa-outbox-worker    # status: stopped/errored
pm2 logs wa-outbox-worker --lines 30   # caută eroarea
pm2 start wa-outbox-worker
```

**Cauze frecvente:**

- SUPABASE_KEY expirat → actualizează .env + `pm2 reload wa-outbox-worker --update-env`
- WA server oprit → `pm2 start whatsapp-integration-v6`
- Eroare fatala în cod → verifică logs, rollback dacă necesar

---

## 2. DLQ > 0 (outbox dead messages)

**Simptom:** `outbox_messages` cu `status=dead`

```bash
# Verificare
curl -s https://wa.superparty.ro/debug/outbox/dlq \
  -H "Authorization: Bearer $FB_TOKEN"

# Replay DLQ
curl -s -X POST https://wa.superparty.ro/debug/outbox/replay \
  -H "Authorization: Bearer $FB_TOKEN"

# Sau direct Supabase:
UPDATE outbox_messages
SET status='queued', attempts=0, error_message=null, next_retry_at=now()
WHERE status='dead';
```

**Cauze frecvente:**

- Sesiune Baileys invalidată → re-link WA QR
- Număr de telefon incorect (JID) → verifică payload
- Rate limit depășit → crește backoff în .env

---

## 3. Stale Ringing (Voice — UI blocat pe apel incoming)

**Simptom:** app arată ring pentru un apel care nu mai există

```bash
# Verificare state Redis
ssh root@91.98.16.90 -i ~/.ssh/antigravity_new
redis-cli ZRANGE active_calls_idx 0 -1 WITHSCORES
redis-cli GET active_call:<callSid>

# Ștergere manuală dacă stuck
redis-cli DEL active_call:<callSid>
redis-cli ZREM active_calls_idx <callSid>
```

**Flutter fix:** app trimite reconcile automat la reconect WS. Dacă e blocat, închide + redeschide app.

**Prune automat:** `pruneStaleZsetMembers` rulează la 5 minute — curăță automat.

---

## 4. Twilio Webhook Fail

**Simptom:** apeluri incoming nu ajung în app; Twilio dashboard arată error 11200/11210

```bash
# Test manual webhook
curl -X POST https://voice.superparty.ro/api/voice/incoming \
  -d "CallSid=CATEST&From=+40700000000&To=+40800000000"

# Nginx OK?
curl -I https://voice.superparty.ro/health

# Voice process OK?
ssh root@91.98.16.90 -i ~/.ssh/antigravity_new
ps aux | grep "node index"
tail -20 /var/log/voice-server.log
```

**Twilio console:** Verifică în Monitor > Errors dacă e 11200 (HTTP error) sau 11210 (timeout).

---

## 5. Redis Down (Voice)

**Simptom:** `[Redis] Error: ECONNREFUSED` în voice logs; active calls returnează []

```bash
ssh root@91.98.16.90 -i ~/.ssh/antigravity_new
redis-cli ping         # dacă FAIL:
systemctl status redis
sudo systemctl restart redis
redis-cli ping         # PONG
```

**Impact:** voice continuă SA funcționeze cu degradare (in-memory fallback parțial). Apeluri active nu se restabilesc automat.

---

## 6. WhatsApp Reconnect / QR Request

**Simptom:** Baileys loguri "Connection Closed", sesiune invalidată

```bash
ssh root@89.167.115.150 -i ~/.ssh/antigravity_new
pm2 logs whatsapp-integration-v6 | grep -E "connection|QR|auth"

# Re-link via QR (în app sau API)
curl http://localhost:3001/api/wa/qr/{accountId}
```

**Important:** `auth_info_multi/` rămâne pe VPS — NU se pierde la `pm2 reload`. Sesiunile supraviețuiesc deploy-ului graceful.

---

## 7. Outbox Stuck (queue nu scade)

**Simptom:** `queue_queued > 0` și nu scade în 15+ minute

```bash
# 1. Worker online?
pm2 status wa-outbox-worker

# 2. Test send-direct auth
curl -X POST http://localhost:3001/api/wa/send-direct \
  -H "Authorization: Bearer $WA_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"accountId":"test","to":"40700@s.whatsapp.net","text":"test"}'
# Așteptat: 400 (missing/wrong params) — NU 403

# 3. Dacă 403: WA_INTERNAL_TOKEN diferit în worker vs server
grep WA_INTERNAL_TOKEN /root/whatsapp-integration-v6/.env
pm2 reload wa-outbox-worker --update-env

# 4. Dacă Baileys error: verifică sesiune WA
```

---

## 8. Supabase Incident

**Simptom:** `SUPABASE_URL` unreachable, outbox toate requests fail

```bash
# Test direct
curl -sf https://ilkphpidhuytucxlglqi.supabase.co/health | head -1

# Dashboard: https://status.supabase.com
```

**Impact:** WA outbox nu poate enqueue sau claim. Worker continuă să retry (exponential backoff).

---

## 9. Deploy Rollback Rapid

```bash
# WA rollback la SHA anterior
bash scripts/deploy_wa.sh <SHA>

# Voice rollback
git checkout -f <SHA> -- server/voice/index.js
bash scripts/deploy_voice.sh

# Verificare rapidă după rollback
curl -s https://wa.superparty.ro/health
curl -s https://voice.superparty.ro/health
```

---

## 10. Checklist First Response (orice incident)

```
[ ] 1. health check WA + Voice
[ ] 2. pm2 list → care procese sunt down?
[ ] 3. pm2 logs <app> --lines 50 → eroarea exactă
[ ] 4. Redis ping (voice)
[ ] 5. Outbox DLQ count (WA)
[ ] 6. git log --oneline -3 → codul curent = cel bun?
[ ] 7. Decide: fix forward sau rollback
[ ] 8. Deploy + smoke test
[ ] 9. Postmortem: ce s-a întâmplat, ce fix, ce previne
```
