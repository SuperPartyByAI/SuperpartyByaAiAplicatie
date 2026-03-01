#!/bin/bash
FROM="$1"
TO="$2"
OUT_REPLAY="./replay_report_$(date -u +%Y%m%dT%H%M%SZ).json"
OUT_VERIFY="./verify_report_$(date -u +%Y%m%dT%H%M%SZ).json"

if [ -z "$FROM" ] || [ -z "$TO" ]; then
  echo "Usage: $0 FROM_ISO TO_ISO"
  exit 1
fi

node /opt/app/superparty-server/admin/replay_baileys_to_database.js --pm2 --lines 5000 --from "$FROM" --to "$TO" --out "$OUT_REPLAY"
node /opt/app/superparty-server/admin/database_verify_and_report.js --from "$FROM" --to "$TO" --out "$OUT_VERIFY"

echo "Replay report: $OUT_REPLAY"
echo "Verify report: $OUT_VERIFY"
