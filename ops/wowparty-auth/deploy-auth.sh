#!/usr/bin/env bash
set -Eeuo pipefail

PORTAL_ROOT="/opt/superparty-portal"
PAYLOAD_ROOT="/tmp/wowparty-auth-${WOWPARTY_AUTH_RUN:?missing run id}"
BACKUP_ROOT="$PORTAL_ROOT/.recovery/20260803_single_team_auth_direct/$WOWPARTY_AUTH_RUN"
BACKUP_READY=0

restore_on_error() {
  local code=$?
  if [ "$code" -ne 0 ] && [ "$BACKUP_READY" -eq 1 ]; then
    echo "Deploy failed; restoring authentication sources from $BACKUP_ROOT"
    cp -a "$BACKUP_ROOT/page.tsx" "$PORTAL_ROOT/src/app/page.tsx"
    cp -a "$BACKUP_ROOT/callback-route.ts" "$PORTAL_ROOT/src/app/auth/callback/route.ts"
    cp -a "$BACKUP_ROOT/middleware.ts" "$PORTAL_ROOT/src/middleware.ts"
    cp -a "$BACKUP_ROOT/select-brand-page.tsx" "$PORTAL_ROOT/src/app/select-brand/page.tsx"
    cp -a "$BACKUP_ROOT/register-business-page.tsx" "$PORTAL_ROOT/src/app/register-business/page.tsx"
    if [ -f "$BACKUP_ROOT/access-pending-page.tsx" ]; then
      mkdir -p "$PORTAL_ROOT/src/app/access-pending"
      cp -a "$BACKUP_ROOT/access-pending-page.tsx" "$PORTAL_ROOT/src/app/access-pending/page.tsx"
    fi
    (cd "$PORTAL_ROOT" && npm run build) || true
    pm2 restart superparty-portal-ai --update-env || true
  fi
  exit "$code"
}
trap restore_on_error EXIT

for required in \
  page.tsx \
  callback-route.ts \
  middleware.ts \
  select-brand-page.tsx \
  register-business-page.tsx \
  access-pending-page.tsx; do
  test -s "$PAYLOAD_ROOT/$required"
done

test -f "$PORTAL_ROOT/package.json"
test -f "$PORTAL_ROOT/src/app/page.tsx"
test -f "$PORTAL_ROOT/src/app/auth/callback/route.ts"
test -f "$PORTAL_ROOT/src/middleware.ts"
test -f "$PORTAL_ROOT/src/app/select-brand/page.tsx"
test -f "$PORTAL_ROOT/src/app/register-business/page.tsx"

mkdir -p "$BACKUP_ROOT"
cp -a "$PORTAL_ROOT/src/app/page.tsx" "$BACKUP_ROOT/page.tsx"
cp -a "$PORTAL_ROOT/src/app/auth/callback/route.ts" "$BACKUP_ROOT/callback-route.ts"
cp -a "$PORTAL_ROOT/src/middleware.ts" "$BACKUP_ROOT/middleware.ts"
cp -a "$PORTAL_ROOT/src/app/select-brand/page.tsx" "$BACKUP_ROOT/select-brand-page.tsx"
cp -a "$PORTAL_ROOT/src/app/register-business/page.tsx" "$BACKUP_ROOT/register-business-page.tsx"
if [ -f "$PORTAL_ROOT/src/app/access-pending/page.tsx" ]; then
  cp -a "$PORTAL_ROOT/src/app/access-pending/page.tsx" "$BACKUP_ROOT/access-pending-page.tsx"
fi
BACKUP_READY=1

install_payload() {
  local source="$1"
  local target="$2"
  mkdir -p "$(dirname "$target")"
  if [ -f "$target" ]; then
    install -o "$(stat -c %u "$target")" -g "$(stat -c %g "$target")" -m "$(stat -c %a "$target")" "$source" "$target"
  else
    install -m 0644 "$source" "$target"
  fi
}

install_payload "$PAYLOAD_ROOT/page.tsx" "$PORTAL_ROOT/src/app/page.tsx"
install_payload "$PAYLOAD_ROOT/callback-route.ts" "$PORTAL_ROOT/src/app/auth/callback/route.ts"
install_payload "$PAYLOAD_ROOT/middleware.ts" "$PORTAL_ROOT/src/middleware.ts"
install_payload "$PAYLOAD_ROOT/select-brand-page.tsx" "$PORTAL_ROOT/src/app/select-brand/page.tsx"
install_payload "$PAYLOAD_ROOT/register-business-page.tsx" "$PORTAL_ROOT/src/app/register-business/page.tsx"
install_payload "$PAYLOAD_ROOT/access-pending-page.tsx" "$PORTAL_ROOT/src/app/access-pending/page.tsx"

if grep -R -n "auth/callback?brand=" "$PORTAL_ROOT/src/app"; then
  echo "Legacy callback loop is still present"
  exit 40
fi

cd "$PORTAL_ROOT"
npm run build

if pm2 describe superparty-portal-ai >/dev/null 2>&1; then
  pm2 restart superparty-portal-ai --update-env
else
  portal_name="$(pm2 jlist | node -e '
    let input="";
    process.stdin.on("data", chunk => input += chunk).on("end", () => {
      const list = JSON.parse(input);
      const match = list.find(item => item?.pm2_env?.pm_cwd === "/opt/superparty-portal");
      if (match?.name) process.stdout.write(match.name);
    });
  ')"
  test -n "$portal_name"
  pm2 restart "$portal_name" --update-env
fi

sleep 6
portal_state="$(pm2 jlist | node -e '
  let input="";
  process.stdin.on("data", chunk => input += chunk).on("end", () => {
    const list = JSON.parse(input);
    const match = list.find(item => item.name === "superparty-portal-ai" || item?.pm2_env?.pm_cwd === "/opt/superparty-portal");
    process.stdout.write(match?.pm2_env?.status || "missing");
  });
')"
echo "PORTAL_PM2_STATUS=$portal_state"
test "$portal_state" = "online"

health="$(curl -fsS --max-time 10 https://app.superparty.ro/api/health)"
echo "HEALTH=$health"
HEALTH_JSON="$health" node -e '
  const health = JSON.parse(process.env.HEALTH_JSON || "{}");
  const backendOk = health.backend === "ok" || health.backend === "online";
  if (health.status !== "ok" || health.portal !== "online" || !backendOk) process.exit(1);
'

for path in / /auth/callback /select-brand /register-business /access-pending /wowparty; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-redirs 0 "https://app.superparty.ro$path" || true)"
  location="$(curl -sSI --max-redirs 0 "https://app.superparty.ro$path" | sed -n 's/^[Ll]ocation: //p' | tr -d '\r' | head -n 1 || true)"
  echo "HTTP path=$path code=$code location=${location:-none}"
  case "$code" in 200|302|303|307|308) ;; *) exit 41 ;; esac
done

worker_state="$(pm2 jlist | node -e '
  let input="";
  process.stdin.on("data", chunk => input += chunk).on("end", () => {
    const list = JSON.parse(input);
    const worker = list.find(item => item.name === "wowparty-agent-worker");
    const env = worker?.pm2_env || {};
    process.stdout.write(JSON.stringify({status: env.status || "missing", outbound: String(env.WA_OUTBOUND_ENABLED ?? "missing")}));
  });
')"
echo "WHATSAPP_WORKER=$worker_state"
WORKER_STATE="$worker_state" node -e '
  const state = JSON.parse(process.env.WORKER_STATE || "{}");
  if (state.status !== "online" || state.outbound !== "false") process.exit(1);
'

echo "RESULT=AUTH_LOOP_FIXED"
echo "BACKUP_ROOT=$BACKUP_ROOT"
trap - EXIT

