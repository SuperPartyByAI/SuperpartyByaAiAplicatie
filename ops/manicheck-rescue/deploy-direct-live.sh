#!/usr/bin/env bash
set -Eeuo pipefail

PAYLOAD_DIR="/root/manicheck-direct-deploy"
SITE="/opt/manicheck-site"
RUN_TAG="${MANICHECK_RUN_TAG:-manual}"
SWITCHED=0
ROLLBACK_DIR=""
RELEASE=""

log() {
  printf '[manicheck-direct] %s\n' "$*"
}

rollback() {
  local code=$?
  if [ "$code" -ne 0 ]; then
    log "ERROR exit_code=$code line=${BASH_LINENO[0]:-unknown}"
  fi
  if [ "$SWITCHED" -eq 1 ] && [ -n "$ROLLBACK_DIR" ] && { [ -L "$ROLLBACK_DIR/dist" ] || [ -e "$ROLLBACK_DIR/dist" ]; }; then
    log "Restoring the previous LIVE release"
    mv "$SITE/dist" "$RELEASE/evidence/failed-dist-link"
    mv "$ROLLBACK_DIR/dist" "$SITE/dist"
    nginx -t >/dev/null 2>&1 || true
    systemctl reload nginx >/dev/null 2>&1 || true
  fi
  exit "$code"
}
trap rollback EXIT

log "Validating sealed payload"
test -s "$PAYLOAD_DIR/manicheck-v1-dist-text.tar.gz"
test -s "$PAYLOAD_DIR/manicheck-v1-text-source.tar.gz"
test -s "$PAYLOAD_DIR/MANICHECK_STORE_V1_MANIFEST.txt"
test -s "$PAYLOAD_DIR/og-image.png"
test -d "$SITE/public/products/freze"

release_id="MANICHECK_STORE_V1_20260803_${RUN_TAG}"
RELEASE="$SITE/releases/$release_id"
ROLLBACK_DIR="$SITE/releases/MANICHECK_ROLLBACK_${RUN_TAG}"
mkdir -p "$RELEASE/dist" "$RELEASE/source" "$RELEASE/evidence" "$ROLLBACK_DIR"

tar -xzf "$PAYLOAD_DIR/manicheck-v1-dist-text.tar.gz" -C "$RELEASE/dist"
tar -xzf "$PAYLOAD_DIR/manicheck-v1-text-source.tar.gz" --strip-components=1 -C "$RELEASE/source"
install -d "$RELEASE/dist/products" "$RELEASE/source/public/products"
cp -a "$SITE/public/products/freze" "$RELEASE/dist/products/"
cp -a "$SITE/public/products/freze" "$RELEASE/source/public/products/"
cp "$PAYLOAD_DIR/og-image.png" "$RELEASE/dist/og-image.png"
cp "$PAYLOAD_DIR/og-image.png" "$RELEASE/source/public/og-image.png"
cp "$PAYLOAD_DIR/MANICHECK_STORE_V1_MANIFEST.txt" "$RELEASE/evidence/"
log "New release extracted: $release_id"

test -s "$RELEASE/dist/index.html"
test -s "$RELEASE/dist/robots.txt"
test -s "$RELEASE/dist/sitemap-index.xml"
test "$(find "$RELEASE/dist/products/freze" -maxdepth 1 -type f -name '*.webp' | wc -l)" -eq 20
grep -q 'Magazin online afiliat pentru manichiură' "$RELEASE/dist/index.html"
grep -q 'Produse</dt><dd[^>]*>20</dd>' "$RELEASE/dist/index.html"
grep -q 'name="robots" content="index,follow' "$RELEASE/dist/index.html"
if grep -qi 'Agregator premium\|Comparăm modele' "$RELEASE/dist/index.html"; then
  log "Comparator copy found in the new release"
  exit 21
fi
log "Release checks passed"

if [ -L "$SITE/dist" ] || [ -d "$SITE/dist" ]; then
  mv "$SITE/dist" "$ROLLBACK_DIR/dist"
else
  log "Current dist is missing"
  exit 22
fi
ln -s "releases/$release_id/dist" "$SITE/dist"
SWITCHED=1

nginx -t
body="$(curl -fsS --max-time 10 -H 'Host: manicheck.ro' http://127.0.0.1/)"
printf '%s' "$body" | grep -q 'Magazin online afiliat pentru manichiură'
printf '%s' "$body" | grep -q 'Produse</dt><dd[^>]*>20</dd>'
if printf '%s' "$body" | grep -qi 'Agregator premium\|Comparăm modele'; then
  exit 23
fi
systemctl reload nginx

cat > "$RELEASE/evidence/DEPLOY_REPORT.txt" <<REPORT
RESULT=DEPLOYED
RUN_TAG=$RUN_TAG
RELEASE=$release_id
PRODUCTS=20
PRODUCT_IMAGES=20
LINK_MODE=REAL_MERCHANT_PRODUCT_URLS
AFFILIATE_REGISTRY=EMPTY_FAIL_CLOSED
ROLLBACK=MANICHECK_ROLLBACK_${RUN_TAG}
REPORT

sync
SWITCHED=0
trap - EXIT
log "RESULT=DEPLOYED release=$release_id"
