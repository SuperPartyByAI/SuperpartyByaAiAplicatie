#!/usr/bin/env bash
set -Eeuo pipefail

PAYLOAD_DIR="/root/manicheck-rescue-deploy"
LIVE_ROOT="/mnt/manicheck-live"
PROBE_ROOT="/mnt/manicheck-probe"
RUN_TAG="${MANICHECK_RUN_TAG:-manual}"
REBOOT_SCHEDULED=0

log() {
  printf '[manicheck-deploy] %s\n' "$*"
}

schedule_live_reboot() {
  if [ "$REBOOT_SCHEDULED" -eq 1 ]; then
    return 0
  fi
  REBOOT_SCHEDULED=1
  sync
  log "Scheduling reboot back to the live disk"
  if command -v systemd-run >/dev/null 2>&1; then
    systemd-run --unit="manicheck-return-${RUN_TAG}" --on-active=3s /usr/bin/systemctl reboot >/dev/null
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
trap 'code=$?; log "ERROR exit=$code line=$LINENO command=$BASH_COMMAND"; exit "$code"' ERR

log "Validating sealed payload"
test -s "$PAYLOAD_DIR/manicheck-v1-dist-text.tar.gz"
test -s "$PAYLOAD_DIR/manicheck-v1-text-source.tar.gz"
test -s "$PAYLOAD_DIR/MANICHECK_STORE_V1_MANIFEST.txt"
test -s "$PAYLOAD_DIR/og-image.png"
mkdir -p "$LIVE_ROOT" "$PROBE_ROOT"

root_device=""
while read -r device filesystem; do
  case "$filesystem" in
    ext4|xfs|btrfs) ;;
    *) continue ;;
  esac
  if mount -o ro "$device" "$PROBE_ROOT" 2>/dev/null; then
    if [ -f "$PROBE_ROOT/etc/os-release" ] && [ -d "$PROBE_ROOT/opt/manicheck-site" ]; then
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

log "Live root identified: $root_device"
mount "$root_device" "$LIVE_ROOT"
site="$LIVE_ROOT/opt/manicheck-site"
test -d "$site"
test -d "$site/public/products/freze"
log "Existing MANICHECK product assets verified"

release_id="MANICHECK_STORE_V1_20260803_${RUN_TAG}"
release="$site/releases/$release_id"
mkdir -p "$release/dist" "$release/source" "$release/evidence"

tar -xzf "$PAYLOAD_DIR/manicheck-v1-dist-text.tar.gz" -C "$release/dist"
tar -xzf "$PAYLOAD_DIR/manicheck-v1-text-source.tar.gz" --strip-components=1 -C "$release/source"
install -d "$release/dist/products" "$release/source/public/products"
cp -a "$site/public/products/freze" "$release/dist/products/"
cp -a "$site/public/products/freze" "$release/source/public/products/"
cp "$PAYLOAD_DIR/og-image.png" "$release/dist/og-image.png"
cp "$PAYLOAD_DIR/og-image.png" "$release/source/public/og-image.png"
cp "$PAYLOAD_DIR/MANICHECK_STORE_V1_MANIFEST.txt" "$release/evidence/"
log "New release extracted: $release_id"

test -s "$release/dist/index.html"
test -s "$release/dist/robots.txt"
test -s "$release/dist/sitemap-index.xml"
test "$(find "$release/dist/products/freze" -maxdepth 1 -type f -name '*.webp' | wc -l)" -eq 20
grep -q 'Magazin online afiliat pentru manichiură' "$release/dist/index.html"
grep -q 'Produse</dt><dd[^>]*>20</dd>' "$release/dist/index.html"
grep -q 'name="robots" content="index,follow' "$release/dist/index.html"
if grep -qi 'Agregator premium\|Comparăm modele' "$release/dist/index.html"; then
  log "Comparator copy found in the new index"
  exit 21
fi
log "New release content checks passed"

mkdir -p "$site/releases/MANICHECK_ROLLBACK_${RUN_TAG}"
if [ -L "$site/dist" ]; then
  mv "$site/dist" "$site/releases/MANICHECK_ROLLBACK_${RUN_TAG}/dist-link"
elif [ -d "$site/dist" ]; then
  mv "$site/dist" "$site/releases/MANICHECK_ROLLBACK_${RUN_TAG}/dist"
else
  log "Current dist is missing"
  exit 22
fi

ln -s "releases/$release_id/dist" "$site/dist"
log "Atomic dist switch completed; previous dist preserved"
cat > "$release/evidence/DEPLOY_REPORT.txt" <<REPORT
RESULT=DEPLOYED
RUN_TAG=$RUN_TAG
ROOT_DEVICE=$root_device
RELEASE=$release_id
PRODUCT_IMAGES=20
AFFILIATE_REGISTRY=EMPTY_FAIL_CLOSED
ROLLBACK=MANICHECK_ROLLBACK_${RUN_TAG}
REPORT

sync
log "RESULT=DEPLOYED release=$release_id root_device=$root_device"
schedule_live_reboot
trap - EXIT
exit 0
