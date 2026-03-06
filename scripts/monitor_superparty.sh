#!/usr/bin/env bash
# monitor_superparty.sh v2 — Alerting cu ntfy.sh push notifications
# Crontab: */5 * * * * bash /root/monitor_superparty.sh
# Subscribe: https://ntfy.sh/superparty-prod-alerts (pe orice browser/app ntfy)
#
# Configurare ALERT_WEBHOOK_URL în .env pentru custom webhook (Discord/Slack)
# Altfel: folosim ntfy.sh topic fix (public, dar cu URL greu de ghicit)
set -euo pipefail

source "$(dirname "$0")/../.env" 2>/dev/null || \
  source /root/whatsapp-integration-v6/.env 2>/dev/null || true

# ── ALERT CHANNEL ────────────────────────────────────────────
NTFY_TOPIC="${NTFY_TOPIC:-superparty-prod-alerts-sp2026}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
LOG_FILE="/var/log/monitor_superparty.log"
NOW=$(date '+%Y-%m-%d %H:%M:%S')
SERVER="${SERVER_NAME:-$(hostname)}"

ALERTS=()
CHECKS=0
PASSED=0

log()   { echo "[$NOW] $1" >> "$LOG_FILE"; }
pass()  { PASSED=$((PASSED+1)); CHECKS=$((CHECKS+1)); log "OK: $1"; }
alert() { CHECKS=$((CHECKS+1)); ALERTS+=("$1"); log "ALERT: $1"; }

send_alert() {
  local title="$1"
  local msg="$2"
  # ntfy.sh (free, no signup)
  curl -sf -X POST "https://ntfy.sh/$NTFY_TOPIC" \
    -H "Title: 🚨 $title" \
    -H "Priority: urgent" \
    -H "Tags: rotating_light" \
    -d "$msg" > /dev/null 2>&1 || true

  # Custom webhook (Discord/Slack format)
  if [ -n "$ALERT_WEBHOOK_URL" ]; then
    curl -sf -X POST "$ALERT_WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"content\":\"🚨 **[$SERVER]** $title\\n$msg\"}" > /dev/null 2>&1 || true
  fi
}

# ══════════════════════════════════════════════════
# CHECK 1: WA Server Health
# ══════════════════════════════════════════════════
WA_HEALTH=$(curl -sf --max-time 5 http://localhost:3001/health 2>/dev/null \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('status','ERR'))" 2>/dev/null \
  || echo "FAIL")
[ "$WA_HEALTH" = "ok" ] && pass "WA health ok" || alert "WA health FAIL ($WA_HEALTH) — server down?"

# ══════════════════════════════════════════════════
# CHECK 2: PM2 Worker Status
# ══════════════════════════════════════════════════
if command -v pm2 &>/dev/null; then
  WW=$(pm2 describe wa-outbox-worker 2>/dev/null | grep "│ status" | grep -o "online\|stopped\|errored" | head -1)
  [ "$WW" = "online" ] && pass "wa-outbox-worker online" || alert "wa-outbox-worker: $WW — run: pm2 start wa-outbox-worker"
fi

# ══════════════════════════════════════════════════
# CHECK 3: Redis (Voice VPS only)
# ══════════════════════════════════════════════════
if command -v redis-cli &>/dev/null; then
  REDIS_PING=$(redis-cli ping 2>/dev/null || echo "FAIL")
  [ "$REDIS_PING" = "PONG" ] && pass "Redis PONG" || alert "Redis DOWN — voice state unavailable"

  # ZSET orphan check (hourly)
  if [ "$(date '+%M')" = "00" ] || [ "$(date '+%M')" = "30" ]; then
    ZSET=$(redis-cli ZCARD active_calls_idx 2>/dev/null || echo "0")
    KEYS=$(redis-cli KEYS "active_call:*" 2>/dev/null | wc -l)
    [ "$ZSET" != "$KEYS" ] && [ "$ZSET" -gt 0 ] && \
      alert "ZSET orphan drift: idx=$ZSET vs keys=$KEYS" || pass "ZSET consistent ($ZSET)"
  fi
fi

# ══════════════════════════════════════════════════
# CHECK 4: Outbox DLQ + Queue depth (Supabase)
# ══════════════════════════════════════════════════
SUPA_URL="${SUPABASE_URL:-}"
SUPA_KEY="${SUPABASE_SERVICE_KEY:-}"

if [ -n "$SUPA_URL" ] && [ -n "$SUPA_KEY" ]; then
  DLQ=$(curl -sf --max-time 5 \
    "$SUPA_URL/rest/v1/outbox_messages?status=eq.dead&select=id" \
    -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" 2>/dev/null | \
    python3 -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  [ "$DLQ" -gt 0 ] && alert "Outbox DLQ: $DLQ dead messages — POST /debug/outbox/replay" || pass "DLQ=0"

  QLEN=$(curl -sf --max-time 5 \
    "$SUPA_URL/rest/v1/outbox_messages?status=eq.queued&select=id" \
    -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" 2>/dev/null | \
    python3 -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  [ "$QLEN" -gt 50 ] && alert "Queue deep: $QLEN queued — worker stuck?" || pass "Queue=$QLEN"
fi

# ══════════════════════════════════════════════════
# SUMMARY + SEND ALL ALERTS
# ══════════════════════════════════════════════════
log "Checks: $PASSED/$CHECKS OK | Alerts: ${#ALERTS[@]}"

if [ ${#ALERTS[@]} -gt 0 ]; then
  ALERT_BODY=$(printf '%s\n' "${ALERTS[@]}")
  send_alert "SUPERPARTY $SERVER" "$ALERT_BODY"
  echo "[$NOW] ALERTS SENT: $ALERT_BODY" >> "$LOG_FILE"
fi
