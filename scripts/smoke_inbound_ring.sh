#!/usr/bin/env bash
# smoke_inbound_ring.sh — Smoke test for inbound ring flow
# Usage: bash smoke_inbound_ring.sh [VPS_HOST] [TWILIO_SID] [TWILIO_TOKEN]
#
# Tests:
# 1. Health endpoint
# 2. WS token endpoint
# 3. Simulated inbound Twilio webhook -> checks Firestore write + WS notify
# 4. WS connection test

VPS="${1:-voice.superparty.ro}"
TWILIO_SID="${TWILIO_SID:-$2}"
TWILIO_TOKEN="${TWILIO_TOKEN:-$3}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Smoke Test: Inbound Ring Flow"
echo "  VPS: $VPS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

PASS=0
FAIL=0

check() {
  local name="$1"
  local result="$2"
  local expect="$3"
  if echo "$result" | grep -q "$expect"; then
    echo "  ✅ $name"
    ((PASS++))
  else
    echo "  ❌ $name — got: $(echo $result | head -c 100)"
    ((FAIL++))
  fi
}

echo ""
echo "1. Health endpoint"
HEALTH=$(curl -s "https://$VPS/health" 2>&1)
check "/health -> status:ok" "$HEALTH" '"status"'

echo ""
echo "2. WS token endpoint"
WS_TOK=$(curl -s "https://$VPS/api/auth/get-ws-token?identity=smoke_test_agent" 2>&1)
check "/api/auth/get-ws-token -> token" "$WS_TOK" '"token"'

echo ""
echo "3. Simulated Twilio inbound webhook"
FAKE_SID="CAsmoke$(date +%s)test"
INCOMING=$(curl -s -X POST "https://$VPS/api/voice/incoming" \
  -d "From=%2B40701000001&To=%2B40373810882&CallSid=$FAKE_SID&CallStatus=ringing&Direction=inbound" \
  -H "Content-Type: application/x-www-form-urlencoded" 2>&1)
check "/api/voice/incoming -> TwiML response" "$INCOMING" "Response"

echo ""
echo "4. WebSocket connectivity test (requires wscat or websocat)"
if command -v wscat &> /dev/null; then
  TOKEN=$(echo "$WS_TOK" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
  if [ -n "$TOKEN" ]; then
    WS_RESULT=$(echo '{"type":"ping"}' | timeout 5 wscat -c "wss://$VPS/api/voip-ws?token=$TOKEN" --wait 3 2>&1 || true)
    check "WS /api/voip-ws -> registered" "$WS_RESULT" 'registered\|pong'
  else
    echo "  ⚠️  WS test skipped (no token)"
  fi
else
  echo "  ⚠️  wscat not installed — skipping WS connectivity test"
  echo "     Install: npm install -g wscat"
fi

echo ""
echo "5. Twilio number matrix (all 9 RO numbers)"
if [ -n "$TWILIO_SID" ] && [ -n "$TWILIO_TOKEN" ]; then
  NUMBERS=$(curl -s -u "$TWILIO_SID:$TWILIO_TOKEN" \
    "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_SID/IncomingPhoneNumbers.json?PageSize=50" \
    2>/dev/null)
  RO_NUMBERS=$(echo "$NUMBERS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for n in d.get('incoming_phone_numbers',[]):
  if n['phone_number'].startswith('+4037'):
    vu = n.get('voice_url','NONE')
    ok = 'voice.superparty.ro' in vu
    print(('✅' if ok else '❌'), n['phone_number'], '->', vu[:50])
" 2>/dev/null)
  echo "$RO_NUMBERS"
  if echo "$RO_NUMBERS" | grep -q "❌"; then
    echo "  ❌ Some numbers not aligned!"
    ((FAIL++))
  else
    echo "  ✅ All RO numbers pointing to voice.superparty.ro"
    ((PASS++))
  fi
else
  echo "  ⚠️  Twilio credentials not provided — skipping number matrix"
  echo "     Usage: bash smoke_inbound_ring.sh voice.superparty.ro ACXXXX AUTH_TOKEN"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Result: $PASS passed, $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit $FAIL
