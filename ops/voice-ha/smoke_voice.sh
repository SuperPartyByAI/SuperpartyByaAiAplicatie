#!/usr/bin/env bash
# smoke_voice.sh — quick regression checks for voice.superparty.ro
# Usage: ./smoke_voice.sh
# Optional: VOICE_HOST=voice.superparty.ro CONTAINER=superparty-voice ./smoke_voice.sh
set -euo pipefail

VOICE_HOST="${VOICE_HOST:-voice.superparty.ro}"
VOICE_URL="${VOICE_URL:-https://$VOICE_HOST}"
CONTAINER="${CONTAINER:-superparty-voice}"
INTERNAL_HEALTH_URL="${INTERNAL_HEALTH_URL:-http://127.0.0.1:3001/health}"

pass() { printf "✅ %s\n" "$*"; }
fail() { printf "❌ %s\n" "$*" >&2; FAILED=1; }
info() { printf "ℹ️  %s\n" "$*"; }

FAILED=0
need() { command -v "$1" >/dev/null 2>&1 || { fail "Missing dependency: $1"; exit 1; }; }

need curl
need dig

info "VOICE_HOST=$VOICE_HOST"
info "VOICE_URL=$VOICE_URL"
echo ""

# ── 1) DNS single IP ─────────────────────────────────────────────────────────
IPS="$(dig +short "$VOICE_HOST" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true)"
IP_COUNT="$(printf "%s\n" "$IPS" | sed '/^$/d' | wc -l | tr -d ' ')"
if [ "$IP_COUNT" -eq 1 ]; then
  pass "DNS single IP: $IPS"
else
  fail "DNS is NOT single-IP (count=$IP_COUNT). Got: $IPS"
fi

# ── 2) TLS + external /health ─────────────────────────────────────────────────
HEALTH_BODY="$(curl -fsS --max-time 10 "$VOICE_URL/health" 2>/dev/null || true)"
if echo "$HEALTH_BODY" | grep -q '"status":"ok"'; then
  pass "External /health OK"
else
  fail "External /health FAILED: $HEALTH_BODY"
fi

# ── 3) push-ack sanity (expect 400 missing_params, not 404) ──────────────────
TMP_BODY="$(mktemp)"
HTTP_CODE="$(curl -sS -o "$TMP_BODY" -w "%{http_code}" --max-time 10 \
  -X POST "$VOICE_URL/api/voice/push-ack" \
  -H "Content-Type: application/json" \
  -d '{}' 2>/dev/null || echo "000")"
BODY="$(cat "$TMP_BODY" 2>/dev/null || true)"
rm -f "$TMP_BODY"

if [ "$HTTP_CODE" = "400" ] && echo "$BODY" | grep -q 'missing_params'; then
  pass "push-ack returns 400 missing_params"
else
  fail "push-ack expected 400/missing_params, got $HTTP_CODE body=$BODY"
fi

# ── 4) makeCall sanity (expect 401 unauthorized, not 404) ────────────────────
TMP_BODY2="$(mktemp)"
HTTP_CODE2="$(curl -sS -o "$TMP_BODY2" -w "%{http_code}" --max-time 10 \
  -X POST "$VOICE_URL/api/voice/makeCall" \
  -H "Content-Type: application/json" \
  -d '{}' 2>/dev/null || echo "000")"
BODY2="$(cat "$TMP_BODY2" 2>/dev/null || true)"
rm -f "$TMP_BODY2"

if [ "$HTTP_CODE2" = "401" ]; then
  pass "makeCall returns 401 (endpoint exists, auth required)"
elif [ "$HTTP_CODE2" = "400" ]; then
  pass "makeCall returns 400 (endpoint exists)"
else
  fail "makeCall expected 401/400, got $HTTP_CODE2 body=$BODY2"
fi

# ── 5) Server-local checks (only if running on VPS with docker) ──────────────
if command -v docker >/dev/null 2>&1; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
    info "Running server-local checks (container=$CONTAINER)"

    INTERNAL_BODY="$(curl -fsS --max-time 5 "$INTERNAL_HEALTH_URL" 2>/dev/null || true)"
    if echo "$INTERNAL_BODY" | grep -q '"status":"ok"'; then
      pass "Internal /health OK ($INTERNAL_HEALTH_URL)"
    else
      fail "Internal /health not ok: $INTERNAL_BODY"
    fi

    ENV_OUT="$(docker exec -i "$CONTAINER" /bin/sh -c 'printenv' 2>/dev/null | grep -E 'ACK_WAIT_MS|ACK_TOKEN_TTL|PUBLIC_URL|BASE_URL|JWT_SECRET' || true)"
    if echo "$ENV_OUT" | grep -q 'ACK_WAIT_MS='; then
      pass "Container env: ACK_WAIT_MS=$(echo "$ENV_OUT" | grep ACK_WAIT_MS | cut -d= -f2)"
    else
      fail "Missing ACK_WAIT_MS in container env"
    fi
    if echo "$ENV_OUT" | grep -q 'ACK_TOKEN_TTL='; then
      pass "Container env: ACK_TOKEN_TTL=$(echo "$ENV_OUT" | grep ACK_TOKEN_TTL | cut -d= -f2)"
    else
      fail "Missing ACK_TOKEN_TTL in container env"
    fi
  else
    info "Container '$CONTAINER' not running locally — skipping server-local checks."
  fi
else
  info "Docker not found locally — skipping server-local checks."
fi

# ── Result ────────────────────────────────────────────────────────────────────
echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "🎉 SMOKE PASS — all automated checks OK"
else
  echo "💥 SMOKE FAIL — see ❌ above"
  exit 1
fi
