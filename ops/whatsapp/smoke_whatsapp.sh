#!/usr/bin/env bash
# smoke_whatsapp.sh — quick regression checks for WhatsApp Baileys backend
# Usage (local, HTTP):  WA_URL=http://89.167.115.150:3001 ./smoke_whatsapp.sh
# Usage (HTTPS domain): WA_URL=https://api.superparty.ro  ./smoke_whatsapp.sh
set -euo pipefail

WA_URL="${WA_URL:-http://89.167.115.150:3001}"
ADMIN_TOKEN="${WA_ADMIN_TOKEN:-}"   # optional: set to test /metrics

pass() { printf "✅ %s\n" "$*"; }
fail() { printf "❌ %s\n" "$*" >&2; FAILED=1; }
info() { printf "ℹ️  %s\n" "$*"; }

FAILED=0
need() { command -v "$1" >/dev/null 2>&1 || { fail "Missing: $1"; exit 1; }; }

need curl
echo ""
info "WA_URL=$WA_URL"
echo ""

# ── 1) Reachability + /health ─────────────────────────────────────────────────
HEALTH="$(curl -fsS --max-time 8 "$WA_URL/health" 2>/dev/null || true)"
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  UPTIME="$(echo "$HEALTH" | grep -o '"uptime":[0-9]*' | cut -d: -f2 || echo '?')"
  SESSIONS="$(echo "$HEALTH" | grep -o '"sessions":[0-9]*' | cut -d: -f2 || echo '?')"
  pass "/health OK  (uptime=${UPTIME}s  sessions=$SESSIONS)"
elif [ -z "$HEALTH" ]; then
  fail "/health: no response (server down or /health not yet deployed — run: pm2 restart all)"
else
  fail "/health FAILED: $HEALTH"
fi

# ── 2) /wa-accounts reachable (note: currently open, no auth required) ────────
TMP="$(mktemp)"
CODE="$(curl -sS -o "$TMP" -w "%{http_code}" --max-time 8 "$WA_URL/api/wa-accounts" 2>/dev/null || echo "000")"
BODY="$(cat "$TMP" || true)"; rm -f "$TMP"

if [ "$CODE" = "200" ]; then
  COUNT="$(echo "$BODY" | grep -o '"id"' | wc -l | tr -d ' ')"
  pass "/api/wa-accounts returns 200 ($COUNT accounts) ⚠️  NO AUTH — endpoint is open"
elif [ "$CODE" = "401" ] || [ "$CODE" = "403" ]; then
  pass "/api/wa-accounts returns $CODE (auth required)"
else
  fail "/api/wa-accounts expected 200/401, got $CODE"
fi

# ── 3) /metrics (optional, only if WA_ADMIN_TOKEN set) ───────────────────────
if [ -n "$ADMIN_TOKEN" ]; then
  MCODE="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 8 \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    "$WA_URL/metrics" 2>/dev/null || echo "000")"
  if [ "$MCODE" = "200" ]; then
    pass "/metrics returns 200"
  else
    fail "/metrics: expected 200, got $MCODE"
  fi
else
  info "/metrics check skipped (set WA_ADMIN_TOKEN to enable)"
fi

# ── Result ────────────────────────────────────────────────────────────────────
echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "🎉 SMOKE PASS (WA backend)"
else
  echo "💥 SMOKE FAIL — see ❌ above"
  exit 1
fi
