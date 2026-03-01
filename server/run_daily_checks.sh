#!/bin/bash
export SUPABASE_SERVICE_ACCOUNT_PATH=/root/whatsapp-integration-v6/supabaseServiceAccount.json
WORKDIR=/root/whatsapp-integration-v6
REPORT_DIR=/var/log/wa_checks
mkdir -p "$REPORT_DIR"

# generate evidence + analyze
node $WORKDIR/generate_evidence_report.js > "$REPORT_DIR/antigravity_evidence_$(date -I).json"
node $WORKDIR/analyze_evidence.js "$REPORT_DIR/antigravity_evidence_$(date -I).json" > "$REPORT_DIR/verify_$(date -I).txt"

# optional: send to slack if problem
if grep -q "PROBLEMĂ" "$REPORT_DIR/verify_$(date -I).txt"; then
  /opt/ops/slack_notify.sh "WA verification failed on $(hostname) — see $REPORT_DIR/verify_$(date -I).txt"
else
  /opt/ops/slack_notify.sh "WA verification OK on $(hostname) — all accounts connected."
fi
