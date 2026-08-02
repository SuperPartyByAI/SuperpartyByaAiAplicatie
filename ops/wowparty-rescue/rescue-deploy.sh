#!/usr/bin/env bash
set -Eeuo pipefail

PAYLOAD_DIR="/root/wowparty-rescue-payload"
LIVE_ROOT="/mnt/wowparty-live"
PROBE_ROOT="/mnt/wowparty-probe"
RUN_TAG="${WOWPARTY_RUN_TAG:-manual}"
RESCUE_REPORT="/root/wowparty-rescue-${RUN_TAG}.log"
REBOOT_SCHEDULED=0

exec > >(tee -a "$RESCUE_REPORT") 2>&1

log() {
  printf '[wowparty-rescue] %s\n' "$*"
}

schedule_live_reboot() {
  if [ "$REBOOT_SCHEDULED" -eq 1 ]; then
    return 0
  fi
  REBOOT_SCHEDULED=1
  sync
  log "Scheduling reboot back to the live disk"
  if command -v systemd-run >/dev/null 2>&1; then
    systemd-run --unit="wowparty-return-live-${RUN_TAG}" --on-active=4s /usr/bin/systemctl reboot >/dev/null
  else
    nohup sh -c 'sleep 4; reboot' >/dev/null 2>&1 &
  fi
}

on_exit() {
  local code=$?
  if [ "$code" -ne 0 ]; then
    log "RESULT=FAILED exit_code=$code"
  fi
  schedule_live_reboot || true
  exit "$code"
}
trap on_exit EXIT

for required in \
  "$PAYLOAD_DIR/wowparty-agent.js" \
  "$PAYLOAD_DIR/job-worker.js" \
  "$PAYLOAD_DIR/page.tsx" \
  "$PAYLOAD_DIR/EvenimenteClient.tsx" \
  "$PAYLOAD_DIR/ephemeral.pub"; do
  test -s "$required"
done

mkdir -p "$LIVE_ROOT" "$PROBE_ROOT"

root_device=""
while read -r device filesystem; do
  case "$filesystem" in
    ext4|xfs|btrfs) ;;
    *) continue ;;
  esac
  if mount -o ro "$device" "$PROBE_ROOT" 2>/dev/null; then
    if [ -f "$PROBE_ROOT/etc/os-release" ] && [ -d "$PROBE_ROOT/opt" ]; then
      root_device="$device"
    fi
    umount "$PROBE_ROOT"
  fi
  if [ -n "$root_device" ]; then
    break
  fi
done < <(lsblk -rpn -o NAME,FSTYPE)

if [ -z "$root_device" ]; then
  log "Unable to identify the live root filesystem"
  exit 20
fi

log "Live root device: $root_device"
mount "$root_device" "$LIVE_ROOT"

# Keep the one-time workflow key usable only until this rescue run finishes.
install -d -m 700 "$LIVE_ROOT/root/.ssh"
touch "$LIVE_ROOT/root/.ssh/authorized_keys"
chmod 600 "$LIVE_ROOT/root/.ssh/authorized_keys"
ephemeral_key="$(tr -d '\r\n' < "$PAYLOAD_DIR/ephemeral.pub")"
if ! grep -qxF "$ephemeral_key" "$LIVE_ROOT/root/.ssh/authorized_keys"; then
  printf '%s\n' "$ephemeral_key" >> "$LIVE_ROOT/root/.ssh/authorized_keys"
fi

known_agent="$LIVE_ROOT/opt/superparty/backend/src/agents/wowparty-agent.js"
if [ -f "$known_agent" ]; then
  agent_target="$known_agent"
else
  mapfile -t agent_candidates < <(
    find "$LIVE_ROOT/opt" -xdev -type f -name 'wowparty-agent.js' \
      -not -path '*/node_modules/*' \
      -not -path '*/.git/*' \
      -not -path '*/backup/*' \
      -not -path '*/backups/*' \
      -not -path '*/archive/*' \
      -not -path '*/archives/*' \
      -print
  )
  if [ "${#agent_candidates[@]}" -ne 1 ]; then
    log "Expected one live wowparty-agent.js, found ${#agent_candidates[@]}"
    printf '%s\n' "${agent_candidates[@]:-none}"
    exit 21
  fi
  agent_target="${agent_candidates[0]}"
fi

worker_target="$(dirname "$agent_target")/job-worker.js"
if [ ! -f "$worker_target" ]; then
  log "job-worker.js is not beside the live agent: $worker_target"
  exit 22
fi

mapfile -t client_candidates < <(
  find "$LIVE_ROOT/opt" -xdev -type f -name 'EvenimenteClient.tsx' \
    -not -path '*/node_modules/*' \
    -not -path '*/.git/*' \
    -not -path '*/backup/*' \
    -not -path '*/backups/*' \
    -not -path '*/archive/*' \
    -not -path '*/archives/*' \
    -print
)
if [ "${#client_candidates[@]}" -ne 1 ]; then
  log "Expected one live EvenimenteClient.tsx, found ${#client_candidates[@]}"
  printf '%s\n' "${client_candidates[@]:-none}"
  exit 23
fi
client_target="${client_candidates[0]}"
page_target="$(dirname "$client_target")/page.tsx"
if [ ! -f "$page_target" ]; then
  log "page.tsx is not beside EvenimenteClient.tsx: $page_target"
  exit 24
fi

portal_root="$(dirname "$client_target")"
while [[ "$portal_root" == "$LIVE_ROOT/opt"* ]]; do
  if [ -f "$portal_root/package.json" ]; then
    break
  fi
  portal_root="$(dirname "$portal_root")"
done
if [ ! -f "$portal_root/package.json" ]; then
  log "Unable to locate the portal package.json"
  exit 25
fi

log "Agent target: ${agent_target#$LIVE_ROOT}"
log "Worker target: ${worker_target#$LIVE_ROOT}"
log "Events client target: ${client_target#$LIVE_ROOT}"
log "Events page target: ${page_target#$LIVE_ROOT}"
log "Portal root: ${portal_root#$LIVE_ROOT}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_root="$LIVE_ROOT/opt/wowparty-rescue-backups/$stamp"
mkdir -p "$backup_root/backend" "$backup_root/portal"
cp -a "$agent_target" "$backup_root/backend/wowparty-agent.js"
cp -a "$worker_target" "$backup_root/backend/job-worker.js"
cp -a "$client_target" "$backup_root/portal/EvenimenteClient.tsx"
cp -a "$page_target" "$backup_root/portal/page.tsx"

install_patch() {
  local source_file="$1"
  local target_file="$2"
  local staged_file="${target_file}.wowparty-new-${RUN_TAG}"
  cp "$source_file" "$staged_file"
  chown --reference="$target_file" "$staged_file"
  chmod --reference="$target_file" "$staged_file"
  mv -f "$staged_file" "$target_file"
}

install_patch "$PAYLOAD_DIR/wowparty-agent.js" "$agent_target"
install_patch "$PAYLOAD_DIR/job-worker.js" "$worker_target"
install_patch "$PAYLOAD_DIR/EvenimenteClient.tsx" "$client_target"
install_patch "$PAYLOAD_DIR/page.tsx" "$page_target"

agent_inside="${agent_target#$LIVE_ROOT}"
worker_inside="${worker_target#$LIVE_ROOT}"
portal_inside="${portal_root#$LIVE_ROOT}"

log "Checking backend JavaScript syntax"
chroot "$LIVE_ROOT" /bin/bash -lc "node --check '$agent_inside' && node --check '$worker_inside'"

for bind_name in dev proc sys run; do
  if [ -d "/$bind_name" ] && [ -d "$LIVE_ROOT/$bind_name" ]; then
    mount --rbind "/$bind_name" "$LIVE_ROOT/$bind_name" || true
    mount --make-rslave "$LIVE_ROOT/$bind_name" || true
  fi
done

log "Building the WowParty portal"
chroot "$LIVE_ROOT" /bin/bash -lc "cd '$portal_inside' && npm run build"

live_report="$LIVE_ROOT/root/wowparty-rescue-deploy-$stamp.txt"
{
  printf 'RESULT=PATCHED_AND_BUILT\n'
  printf 'TIMESTAMP_UTC=%s\n' "$stamp"
  printf 'ROOT_DEVICE=%s\n' "$root_device"
  printf 'AGENT_TARGET=%s\n' "$agent_inside"
  printf 'WORKER_TARGET=%s\n' "$worker_inside"
  printf 'CLIENT_TARGET=%s\n' "${client_target#$LIVE_ROOT}"
  printf 'PAGE_TARGET=%s\n' "${page_target#$LIVE_ROOT}"
  printf 'PORTAL_ROOT=%s\n' "$portal_inside"
  printf 'BACKUP_ROOT=%s\n' "${backup_root#$LIVE_ROOT}"
  sha256sum "$agent_target" "$worker_target" "$client_target" "$page_target"
} > "$live_report"

log "RESULT=PATCHED_AND_BUILT"
log "Live report: ${live_report#$LIVE_ROOT}"
sync
schedule_live_reboot
trap - EXIT
exit 0
