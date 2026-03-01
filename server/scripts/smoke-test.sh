#!/usr/bin/env bash
set -euo pipefail

# =========================
# SuperParty Smoke Test
# =========================
BASE_URL="${BASE_URL:-http://46.225.182.127:8080}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
ACCOUNT_ID="${ACCOUNT_ID:-}"
JID="${JID:-}"
FILE_PATH="${FILE_PATH:-}"

fail() { echo "❌ $*" >&2; exit 1; }
ok()   { echo "✅ $*"; }

if [[ -z "$ADMIN_TOKEN" ]]; then
  echo "⚠️  ADMIN_TOKEN not set. Admin-protected checks will be skipped."
fi

echo "BASE_URL=$BASE_URL"

echo
echo "== 1) Basic health =="
curl -fsS -D /tmp/headers.txt "$BASE_URL/status" >/tmp/status.json
cat /tmp/status.json | head -c 500; echo
REQ_ID="$(grep -i '^x-request-id:' /tmp/headers.txt | awk '{print $2}' | tr -d '\r' || true)"
[[ -n "$REQ_ID" ]] && ok "X-Request-Id present: $REQ_ID" || fail "Missing X-Request-Id header"
ok "/status OK"

echo
echo "== 2) Metrics endpoint =="
curl -fsS "$BASE_URL/metrics" >/tmp/metrics.txt
grep -E "http_requests_total|http_request_duration_seconds|whatsapp_messages_total|canonical_mismatch_total" /tmp/metrics.txt >/dev/null \
  && ok "Core metrics present" || fail "Missing expected metrics"

CAN_MISMATCH="$(grep -E '^canonical_mismatch_total' /tmp/metrics.txt | head -n1 | awk '{print $2}' || true)"
echo "canonical_mismatch_total=${CAN_MISMATCH:-unknown}"
ok "/metrics OK"

echo
echo "== 3) WhatsApp sessions (/status already includes sessions) =="
CONNECTED_COUNT="$(cat /tmp/status.json | grep -o '"status":"connected"' | wc -l | tr -d ' ')"
echo "Connected sessions: $CONNECTED_COUNT"
if [[ "$CONNECTED_COUNT" -ge 1 ]]; then ok "At least 1 WA session connected"; else echo "⚠️  No connected WA sessions"; fi

echo
echo "== 4) Admin-only checks (optional) =="
if [[ -n "$ADMIN_TOKEN" ]]; then
  curl -fsS "$BASE_URL/debug/store-stats?token=$ADMIN_TOKEN" >/tmp/store-stats.json
  cat /tmp/store-stats.json | head -c 500; echo
  ok "store-stats OK"

  curl -fsS -o /tmp/pair.html "$BASE_URL/pair?token=$ADMIN_TOKEN" && ok "pair page OK" || fail "pair page failed"
else
  echo "Skipping admin checks (no ADMIN_TOKEN)."
fi

echo
echo "== 5) Chats/messages (read-only) =="
curl -fsS "$BASE_URL/chats" >/tmp/chats.json
CHAT_COUNT="$(cat /tmp/chats.json | grep -o '"id"' | wc -l | tr -d ' ')"
echo "Chats returned: $CHAT_COUNT"
ok "/chats OK"

if [[ -n "$JID" ]]; then
  curl -fsS "$BASE_URL/messages/$(python3 - <<PY
import urllib.parse, os
print(urllib.parse.quote(os.environ["JID"], safe=""))
PY
)" >/tmp/messages.json
  MSG_COUNT="$(cat /tmp/messages.json | grep -o '"key"' | wc -l | tr -d ' ')"
  echo "Messages returned for $JID: $MSG_COUNT"
  ok "/messages/:jid OK"
else
  echo "Skipping /messages/:jid (set JID=... to test)."
fi

echo
echo "== 6) Canonical anti-amestec quick check =="
BEFORE_MISMATCH="$(grep -E '^canonical_mismatch_total' /tmp/metrics.txt | head -n1 | awk '{print $2}' || echo "")"
echo "canonical_mismatch_total (before)=$BEFORE_MISMATCH"

echo
echo "== 7) Send text (optional) =="
if [[ -n "$JID" && -n "$ACCOUNT_ID" ]]; then
  curl -fsS -X POST "$BASE_URL/messages/$(python3 - <<PY
import urllib.parse, os
print(urllib.parse.quote(os.environ["JID"], safe=""))
PY
)" \
    -H "Content-Type: application/json" \
    -d "$(python3 - <<PY
import json, os, time
print(json.dumps({"text": f"Smoke test text {int(time.time())}", "accountId": os.environ["ACCOUNT_ID"]}))
PY
)" >/tmp/send-text.json
  cat /tmp/send-text.json | head -c 500; echo
  ok "Send text OK"
else
  echo "Skipping send text (set JID and ACCOUNT_ID)."
fi

echo
echo "== 8) Outbound media upload (optional) =="
if [[ -n "$JID" && -n "$ACCOUNT_ID" && -n "$FILE_PATH" && -f "$FILE_PATH" ]]; then
  echo "Uploading file: $FILE_PATH"
  set +e
  curl -fsS -X POST "$BASE_URL/messages/$(python3 - <<PY
import urllib.parse, os
print(urllib.parse.quote(os.environ["JID"], safe=""))
PY
)/media" \
    -F "accountId=$ACCOUNT_ID" \
    -F "file=@$FILE_PATH" \
    -F "caption=Smoke test media upload" \
    >/tmp/send-media.json
  RC=$?
  set -e
  if [[ "$RC" -eq 0 ]]; then
    cat /tmp/send-media.json | head -c 500; echo
    ok "Outbound media upload OK"
  else
    echo "⚠️  Outbound media upload failed."
  fi
else
  echo "Skipping outbound media (set JID, ACCOUNT_ID, FILE_PATH)."
fi

echo
echo "== 9) Media fetch from store (optional) =="
MEDIA_MSG_ID="${MEDIA_MSG_ID:-}"
if [[ -n "$JID" && -n "$MEDIA_MSG_ID" ]]; then
  curl -fsS -o /tmp/media.bin "$BASE_URL/media/$(python3 - <<PY
import urllib.parse, os
print(urllib.parse.quote(os.environ["JID"], safe=""))
PY
)/$MEDIA_MSG_ID"
  ls -lh /tmp/media.bin
  ok "Downloaded /media/:jid/:id OK"
else
  echo "Skipping /media/:jid/:id (set MEDIA_MSG_ID and JID)."
fi

echo
echo "== 10) Metrics after tests =="
curl -fsS "$BASE_URL/metrics" >/tmp/metrics_after.txt
AFTER_MISMATCH="$(grep -E '^canonical_mismatch_total' /tmp/metrics_after.txt | head -n1 | awk '{print $2}' || echo "")"
echo "canonical_mismatch_total (after)=$AFTER_MISMATCH"
if [[ -n "${BEFORE_MISMATCH:-}" && -n "${AFTER_MISMATCH:-}" ]]; then
  if [[ "$AFTER_MISMATCH" == "$BEFORE_MISMATCH" ]]; then
    ok "Anti-amestec metric unchanged"
  else
    echo "⚠️  canonical_mismatch_total changed: $BEFORE_MISMATCH -> $AFTER_MISMATCH"
  fi
fi

echo
echo "== DONE =="
ok "Smoke test completed"
