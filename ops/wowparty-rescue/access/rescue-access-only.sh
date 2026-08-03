#!/usr/bin/env bash
set -Eeuo pipefail

PAYLOAD_DIR="/root/wowparty-rescue-access"
LIVE_ROOT="/mnt/wowparty-live"
PROBE_ROOT="/mnt/wowparty-probe"
RUN_TAG="${WOWPARTY_RUN_TAG:-manual}"
REBOOT_SCHEDULED=0

log() {
  printf '[wowparty-access] %s\n' "$*"
}

schedule_live_reboot() {
  if [ "$REBOOT_SCHEDULED" -eq 1 ]; then
    return 0
  fi
  REBOOT_SCHEDULED=1
  sync
  log "Scheduling reboot back to the live disk"
  if command -v systemd-run >/dev/null 2>&1; then
    systemd-run --unit="wowparty-access-return-${RUN_TAG}" --on-active=3s /usr/bin/systemctl reboot >/dev/null
  else
    nohup sh -c 'sleep 3; reboot' >/dev/null 2>&1 &
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

test -s "$PAYLOAD_DIR/ephemeral.pub"
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

mount "$root_device" "$LIVE_ROOT"
install -d -m 700 "$LIVE_ROOT/root/.ssh"
touch "$LIVE_ROOT/root/.ssh/authorized_keys"
chmod 600 "$LIVE_ROOT/root/.ssh/authorized_keys"
ephemeral_key="$(tr -d '\r\n' < "$PAYLOAD_DIR/ephemeral.pub")"
if ! grep -qxF "$ephemeral_key" "$LIVE_ROOT/root/.ssh/authorized_keys"; then
  printf '%s\n' "$ephemeral_key" >> "$LIVE_ROOT/root/.ssh/authorized_keys"
fi

log "RESULT=LIVE_ACCESS_READY root_device=$root_device"
sync
schedule_live_reboot
trap - EXIT
exit 0
