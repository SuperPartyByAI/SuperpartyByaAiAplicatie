#!/usr/bin/env bash
set -Eeuo pipefail

PORTAL_ROOT="${PORTAL_ROOT:-/opt/superparty-portal}"
POST_RESTART_WAIT_SECONDS="${POST_RESTART_WAIT_SECONDS:-6}"
RUN_ID="${WOWPARTY_HOTFIX_RUN:-$(date -u +%Y%m%dT%H%M%SZ)}"
BACKUP_ROOT="$PORTAL_ROOT/.recovery/wowparty-auth-loop-minimal/$RUN_ID"
SOURCE_FILE="$PORTAL_ROOT/src/app/page.tsx"
BACKUP_FILE=""
PORTAL_PROCESS=""
BACKUP_READY=0

rollback() {
  local exit_code=$?
  if [ "$exit_code" -ne 0 ] && [ "$BACKUP_READY" -eq 1 ]; then
    echo "Hotfix failed; restoring $SOURCE_FILE"
    cp -a "$BACKUP_FILE" "$SOURCE_FILE"
    (cd "$PORTAL_ROOT" && npm run build) || true
    if [ -n "$PORTAL_PROCESS" ]; then
      pm2 restart "$PORTAL_PROCESS" --update-env || true
    fi
  fi
  exit "$exit_code"
}
trap rollback EXIT

test -d "$PORTAL_ROOT/src"
test -f "$PORTAL_ROOT/package.json"

test -f "$SOURCE_FILE"
if ! grep -n -F '/auth/callback?brand=' "$SOURCE_FILE"; then
  echo "The live entry page does not contain the expected brand callback"
  exit 30
fi
mkdir -p "$BACKUP_ROOT"
BACKUP_FILE="$BACKUP_ROOT/$(basename "$SOURCE_FILE")"
cp -a "$SOURCE_FILE" "$BACKUP_FILE"
BACKUP_READY=1

SOURCE_FILE="$SOURCE_FILE" node <<'NODE'
const fs = require('fs');
const file = process.env.SOURCE_FILE;
const before = fs.readFileSync(file, 'utf8');
const patterns = [
  /router\.push\(\s*`\/auth\/callback\?brand=\$\{[^}]+\}`\s*\)/g,
  /router\.push\(\s*["']\/auth\/callback\?brand=["']\s*\+\s*[^)]+\)/g,
  /router\.push\(\s*["']\/auth\/callback\?brand=[^"']+["']\s*\)/g,
];

let occurrences = 0;
let after = before;
for (const pattern of patterns) {
  const matches = before.match(pattern) || [];
  const count = matches.length;
  occurrences += count;
  if (count === 1) after = after.replace(pattern, 'router.replace("/wowparty")');
}

if (occurrences !== 1 || after === before) {
  console.error(`Expected one exact callback expression; found ${occurrences}`);
  process.exit(31);
}

fs.writeFileSync(file, after);
NODE

if ! grep -n -F 'router.replace("/wowparty")' "$SOURCE_FILE"; then
  echo "Direct WowParty route was not written"
  exit 32
fi

cd "$PORTAL_ROOT"
npm run build

PORTAL_PROCESS="$(pm2 jlist | node -e '
let input = "";
process.stdin.on("data", chunk => input += chunk).on("end", () => {
  const list = JSON.parse(input);
  const match = list.find(item =>
    item.name === "superparty-portal-ai" ||
    item?.pm2_env?.pm_cwd === "/opt/superparty-portal"
  );
  if (match?.name) process.stdout.write(match.name);
});
')"
test -n "$PORTAL_PROCESS"

pm2 restart "$PORTAL_PROCESS" --update-env
sleep "$POST_RESTART_WAIT_SECONDS"

pm2_json="$(pm2 jlist)"
PORTAL_PROCESS="$PORTAL_PROCESS" PM2_JSON="$pm2_json" node -e '
const list = JSON.parse(process.env.PM2_JSON || "[]");
const name = process.env.PORTAL_PROCESS;
const match = list.find(item => item.name === name);
if (match?.pm2_env?.status !== "online") process.exit(1);
'

health="$(curl -fsS --max-time 15 "https://app.superparty.ro/api/health?hotfix=$RUN_ID")"
HEALTH_JSON="$health" node -e '
const health = JSON.parse(process.env.HEALTH_JSON || "{}");
const backendOk = health.backend === "ok" || health.backend === "online";
if (health.status !== "ok" || health.portal !== "online" || !backendOk) {
  process.exit(1);
}
'

echo "RESULT=WOWPARTY_AUTH_LOOP_MINIMAL_PATCH_DEPLOYED"
echo "SOURCE_FILE=$SOURCE_FILE"
echo "BACKUP_FILE=$BACKUP_FILE"
echo "PORTAL_PROCESS=$PORTAL_PROCESS"
echo "HEALTH=$health"
trap - EXIT
