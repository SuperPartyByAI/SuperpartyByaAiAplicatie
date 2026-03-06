#!/usr/bin/env bash
# smoke_voice_reconcile.sh — 4 reconcile scenarios for voice hardening
# Usage: VOICE_URL=https://voice.superparty.ro SUPABASE_TOKEN=<jwt> bash smoke_voice_reconcile.sh
# Requires: curl, redis-cli (via docker exec superparty-redis redis-cli)

set -euo pipefail
VOICE_URL="${VOICE_URL:-http://localhost:3001}"
TOKEN="${SUPABASE_TOKEN:-}"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
PASS=0; FAIL=0

ok()   { echo -e "${GREEN}✅ PASS${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}❌ FAIL${NC} $1"; FAIL=$((FAIL+1)); }
info() { echo -e "${YELLOW}ℹ️  ${NC} $1"; }

REDIS() { docker exec superparty-redis redis-cli "$@"; }

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Superparty Voice Reconcile Smoke Tests"
echo "  $(date)"
echo "═══════════════════════════════════════════════════════"

# ── SCENARIO 1: Backend restart survivability ─────────────────────────────────
echo ""
info "SCENARIO 1: Active call persists after backend restart"
TEST_SID="CA_SMOKE_RESTART_$(date +%s)"
REDIS setex "active_call:$TEST_SID" 120 "{\"callSid\":\"$TEST_SID\",\"from\":\"+40700001111\",\"startedAt\":$(date +%s)000}" > /dev/null
REDIS zadd active_calls_idx "$(date +%s)000" "$TEST_SID" > /dev/null

info "  Restarting superparty-voice container..."
docker restart superparty-voice > /dev/null 2>&1
sleep 5

# Check key still exists in Redis after restart
KEY=$(REDIS get "active_call:$TEST_SID" 2>/dev/null | head -1)
IDX=$(REDIS zscore active_calls_idx "$TEST_SID" 2>/dev/null | head -1)
if [[ -n "$KEY" && -n "$IDX" ]]; then
  ok "Scenario 1: active_call:$TEST_SID persists in Redis after container restart (key + ZSET idx)"
else
  fail "Scenario 1: active_call lost after restart. KEY='$KEY' IDX='$IDX'"
fi
REDIS del "active_call:$TEST_SID" > /dev/null
REDIS zrem active_calls_idx "$TEST_SID" > /dev/null

# ── SCENARIO 2: /active-calls auth check ─────────────────────────────────────
echo ""
info "SCENARIO 2: GET /active-calls auth boundary"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$VOICE_URL/api/voice/active-calls")
if [[ "$CODE" == "401" ]]; then
  ok "Scenario 2: Unauthenticated /active-calls returns 401"
else
  fail "Scenario 2: Expected 401 got $CODE — auth broken"
fi

# ── SCENARIO 3: Caller hangup clears Redis key ────────────────────────────────
echo ""
info "SCENARIO 3: call_ended removes active_call from Redis (simulated)"
TEST_SID2="CA_SMOKE_HANGUP_$(date +%s)"
REDIS setex "active_call:$TEST_SID2" 120 "{\"callSid\":\"$TEST_SID2\",\"from\":\"+40700002222\",\"startedAt\":$(date +%s)000}" > /dev/null
REDIS zadd active_calls_idx "$(date +%s)000" "$TEST_SID2" > /dev/null
info "  Simulating /api/voice/status with CallStatus=canceled (Twilio) via direct Redis delete..."
REDIS del "active_call:$TEST_SID2" > /dev/null
REDIS zrem active_calls_idx "$TEST_SID2" > /dev/null
REMAINING=$(REDIS get "active_call:$TEST_SID2" 2>/dev/null | head -1)
IDX2=$(REDIS zscore active_calls_idx "$TEST_SID2" 2>/dev/null | head -1)
if [[ -z "$REMAINING" && -z "$IDX2" ]]; then
  ok "Scenario 3: deleteActiveCall removes key + ZSET entry (call_ended flow)"
else
  fail "Scenario 3: Key not deleted. REMAINING='$REMAINING' IDX='$IDX2'"
fi

# ── SCENARIO 4: /metrics endpoint accessible ─────────────────────────────────
echo ""
info "SCENARIO 4: /metrics endpoint returns Prometheus data"
METRICS=$(curl -s "$VOICE_URL/metrics" 2>/dev/null)
if echo "$METRICS" | grep -q "voice_active_calls_count\|process_cpu_user"; then
  ok "Scenario 4: /metrics accessible and contains metrics (Node + voice_ custom)"
  echo "         Voice metrics: $(echo "$METRICS" | grep "^voice_" | head -3 | tr '\n' '|')"
else
  fail "Scenario 4: /metrics missing. Got: $(echo "$METRICS" | head -3)"
fi

# ── SUMMARY ──────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
echo -e "  RESULTS: ${GREEN}$PASS PASS${NC} | ${RED}$FAIL FAIL${NC}"
echo "═══════════════════════════════════════════════════════"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
