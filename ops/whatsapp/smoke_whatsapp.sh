#!/usr/bin/env bash
# smoke_whatsapp.sh — WhatsApp backend smoke test
# Usage: ADMIN_TOKEN=xxx WA_BASE=https://wa.superparty.ro ./smoke_whatsapp.sh
# Or:    ./smoke_whatsapp.sh <ADMIN_TOKEN>
set -euo pipefail

WA_BASE="${WA_BASE:-https://wa.superparty.ro}"
ADMIN_TOKEN="${1:-${ADMIN_TOKEN:-}}"
FAIL=0
PASS=0

ok()   { echo "  ✅ $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $*"; FAIL=$((FAIL+1)); }
info() { echo "  ℹ️  $*"; }

header() { echo ""; echo "══════════════════════════════════════════"; echo "  $*"; echo "══════════════════════════════════════════"; }

header "WhatsApp Smoke Test — ${WA_BASE}"
echo "  Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 1) Health (public)
header "1) Health"
STATUS=$(curl -sk -o /dev/null -w "%{http_code}" "${WA_BASE}/health")
[[ "$STATUS" == "200" ]] && ok "GET /health → 200" || fail "GET /health → ${STATUS} (expected 200)"

BODY=$(curl -sk "${WA_BASE}/health")
echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('     sessions:', d.get('sessions'), '| uptime:', d.get('uptime'), 's')" 2>/dev/null || info "Health body: $BODY"

# 2) Auth guard — /api/ without token must 401
header "2) Auth Guard"
STATUS=$(curl -sk -o /dev/null -w "%{http_code}" "${WA_BASE}/api/wa-accounts")
[[ "$STATUS" == "401" ]] && ok "GET /api/wa-accounts without token → 401" || fail "GET /api/wa-accounts → ${STATUS} (expected 401)"

STATUS=$(curl -sk -o /dev/null -w "%{http_code}" "${WA_BASE}/metrics")
[[ "$STATUS" == "401" ]] && ok "GET /metrics without token → 401" || fail "GET /metrics → ${STATUS} (expected 401)"

# 3) Debug endpoints (ADMIN_TOKEN)
header "3) Debug Endpoints (ADMIN_TOKEN)"
if [[ -z "$ADMIN_TOKEN" ]]; then
  info "ADMIN_TOKEN not set — skipping debug endpoint checks"
  info "Pass as: ADMIN_TOKEN=xxx ./smoke_whatsapp.sh"
else
  STATUS=$(curl -sk -o /dev/null -w "%{http_code}" "${WA_BASE}/debug/queue-stats?token=${ADMIN_TOKEN}")
  [[ "$STATUS" == "200" ]] && ok "GET /debug/queue-stats → 200" || fail "GET /debug/queue-stats → ${STATUS}"

  QSTATS=$(curl -sk "${WA_BASE}/debug/queue-stats?token=${ADMIN_TOKEN}")
  WA_EVENTS=$(echo "$QSTATS" | python3 -c "import sys,json; d=json.load(sys.stdin); e=d['wa-events']; print('waiting=',e.get('waiting',0), 'failed=',e.get('failed',0))" 2>/dev/null || echo "parse error")
  DLQ=$(echo "$QSTATS" | python3 -c "import sys,json; d=json.load(sys.stdin); e=d['wa-dlq']; total=sum(e.values()); print(total)" 2>/dev/null || echo "?")
  info "wa-events: ${WA_EVENTS}"
  [[ "$DLQ" == "0" ]] && ok "DLQ depth = 0" || fail "DLQ depth = ${DLQ} (investigate!)"

  STATUS=$(curl -sk -o /dev/null -w "%{http_code}" "${WA_BASE}/debug/dlq?token=${ADMIN_TOKEN}")
  [[ "$STATUS" == "200" ]] && ok "GET /debug/dlq → 200" || fail "GET /debug/dlq → ${STATUS}"

  STATUS=$(curl -sk -o /dev/null -w "%{http_code}" "${WA_BASE}/debug/recent-messages?token=${ADMIN_TOKEN}")
  [[ "$STATUS" == "200" ]] && ok "GET /debug/recent-messages → 200" || fail "GET /debug/recent-messages → ${STATUS}"
fi

# 4) Redis AOF (needs SSH, optional)
header "4) Infrastructure (local checks if SKIP_SSH not set)"
if [[ -z "${SKIP_SSH:-}" ]]; then
  info "Set SKIP_SSH=1 to skip SSH checks"
  SSH_KEY="${SSH_KEY:-~/.ssh/antigravity_new}"
  SSH_HOST="${SSH_HOST:-root@89.167.115.150}"
  if ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -i "$SSH_KEY" "$SSH_HOST" 'redis-cli ping' 2>/dev/null | grep -q PONG; then
    ok "Redis PONG"
    AOF=$(ssh -o StrictHostKeyChecking=no -i "$SSH_KEY" "$SSH_HOST" "redis-cli INFO persistence | grep aof_enabled" 2>/dev/null)
    [[ "$AOF" == *"aof_enabled:1"* ]] && ok "Redis AOF enabled" || fail "Redis AOF not enabled!"
    PM2=$(ssh -o StrictHostKeyChecking=no -i "$SSH_KEY" "$SSH_HOST" "pm2 ls 2>/dev/null | grep -c online" 2>/dev/null || echo 0)
    [[ "$PM2" -ge 2 ]] && ok "pm2 processes online: ${PM2}" || fail "pm2 online count: ${PM2} (expected >= 2)"
  else
    info "SSH not available — skip Redis/pm2 checks (set SKIP_SSH=1 to suppress)"
  fi
fi

# Summary
header "SUMMARY"
echo "  PASS: ${PASS}  FAIL: ${FAIL}"
echo ""
[[ "$FAIL" -eq 0 ]] && echo "  🎉 ALL PASSED" || echo "  ❌ ${FAIL} FAILED — investigate above"
exit $FAIL
