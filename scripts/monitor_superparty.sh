#!/usr/bin/env bash
# monitor_superparty.sh — Alerting minim obligatoriu
# Rulează via crontab la fiecare 5 minute pe fiecare VPS
# Crontab: */5 * * * * bash /root/monitor_superparty.sh >> /var/log/monitor.log 2>&1
#
# Alerting: folosește ALERT_WEBHOOK_URL (Discord/Slack webhook) dacă e setat
# Altfel: loghează în /var/log/monitor.log și trimite email dacă mail e configurat
set -euo pipefail

ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
LOG_FILE="/var/log/monitor_superparty.log"
NOW=$(date '+%Y-%m-%d %H:%M:%S')
SERVER="${SERVER_NAME:-$(hostname)}"

# Supabase pentru DLQ check
SUPA_URL="${SUPABASE_URL:-}"
SUPA_KEY="${SUPABASE_SERVICE_KEY:-}"

ALERTS=""
CHECKS=0
PASSED=0

log()   { echo "[$NOW] $1" | tee -a "$LOG_FILE"; }
alert() { ALERTS="${ALERTS}\n🚨 [$SERVER] $1"; log "ALERT: $1"; }
pass()  { PASSED=$((PASSED+1)); CHECKS=$((CHECKS+1)); log "OK: $1"; }
fail()  { CHECKS=$((CHECKS+1)); alert "$1"; }

send_alert() {
  local msg="$1"
  if [ -n "$ALERT_WEBHOOK_URL" ]; then
    curl -sf -X POST "$ALERT_WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"content\": \"$msg\"}" > /dev/null 2>&1 || true
  fi
  # Fallback: email (se poate configura cu mailx/sendmail)
  # echo "$msg" | mail -s "ALERT: $SERVER" ops@superparty.ro 2>/dev/null || true
}

# ══════════════════════════════════════════════════
# CHECK 1: WA Server Health
# ══════════════════════════════════════════════════
WA_HEALTH=$(curl -sf --max-time 5 http://localhost:3001/health 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('status','ERR'))" 2>/dev/null || echo "FAIL")
if [ "$WA_HEALTH" = "ok" ]; then
  pass "WA health: ok"
else
  fail "WA health: $WA_HEALTH (server down?)"
fi

# ══════════════════════════════════════════════════
# CHECK 2: PM2 Worker Status (WA VPS)
# ══════════════════════════════════════════════════
if command -v pm2 &>/dev/null; then
  WA_WORKER=$(pm2 describe wa-outbox-worker 2>/dev/null | grep "status" | grep -o "online\|stopped\|errored" | head -1)
  if [ "$WA_WORKER" = "online" ]; then
    pass "wa-outbox-worker: online"
  else
    fail "wa-outbox-worker: $WA_WORKER — restart: pm2 start wa-outbox-worker"
  fi
fi

# ══════════════════════════════════════════════════
# CHECK 3: Redis Availability (Voice VPS)
# ══════════════════════════════════════════════════
if command -v redis-cli &>/dev/null; then
  REDIS_PING=$(redis-cli ping 2>/dev/null || echo "FAIL")
  if [ "$REDIS_PING" = "PONG" ]; then
    pass "Redis: PONG"
  else
    fail "Redis: DOWN — voice active calls state unavailable"
  fi

  # CHECK 4: ZSET orphan check (once per hour)
  if [ "$(date '+%M')" = "00" ]; then
    ZSET_SIZE=$(redis-cli ZCARD active_calls_idx 2>/dev/null || echo "0")
    KEYS_SIZE=$(redis-cli KEYS "active_call:*" 2>/dev/null | wc -l)
    if [ "$ZSET_SIZE" != "$KEYS_SIZE" ] && [ "$ZSET_SIZE" -gt 0 ]; then
      fail "ZSET orphan drift: idx=$ZSET_SIZE vs keys=$KEYS_SIZE — prune will fix in <5min"
    else
      pass "Redis ZSET consistent: $ZSET_SIZE entries"
    fi
  fi
fi

# ══════════════════════════════════════════════════
# CHECK 5: Outbox DLQ depth (WA — via Supabase)
# ══════════════════════════════════════════════════
if [ -n "$SUPA_URL" ] && [ -n "$SUPA_KEY" ]; then
  DLQ=$(curl -sf --max-time 5 \
    "$SUPA_URL/rest/v1/outbox_messages?status=eq.dead&select=count" \
    -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" \
    -H "Prefer: count=exact" \
    -o /dev/null -w "%{http_code}" 2>/dev/null || echo "ERR")

  DLQ_COUNT=$(curl -sf --max-time 5 \
    "$SUPA_URL/rest/v1/outbox_messages?status=eq.dead&select=id" \
    -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" 2>/dev/null | \
    python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d))" 2>/dev/null || echo "0")

  if [ "$DLQ_COUNT" -gt 0 ]; then
    fail "Outbox DLQ: $DLQ_COUNT dead messages — replay: POST /debug/outbox/replay"
  else
    pass "Outbox DLQ: 0"
  fi

  # CHECK 6: Queue depth (queued > 50 și nu scade = worker blocat)
  QUEUE_COUNT=$(curl -sf --max-time 5 \
    "$SUPA_URL/rest/v1/outbox_messages?status=eq.queued&select=id" \
    -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" 2>/dev/null | \
    python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d))" 2>/dev/null || echo "0")

  if [ "$QUEUE_COUNT" -gt 50 ]; then
    fail "Outbox queue deep: $QUEUE_COUNT messages queued — worker may be stuck"
  else
    pass "Outbox queue: $QUEUE_COUNT"
  fi
fi

# ══════════════════════════════════════════════════
# SUMMARY + SEND ALERT
# ══════════════════════════════════════════════════
log "Monitor summary: $PASSED/$CHECKS OK"

if [ -n "$ALERTS" ]; then
  MSG="**SUPERPARTY ALERT** [$NOW] $SERVER\\n$(echo -e "$ALERTS")"
  send_alert "$MSG"
  log "Alerts sent"
fi
