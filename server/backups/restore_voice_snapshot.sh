#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# RESTORE SCRIPT — Voice Module Working Snapshot (Feb 28, 2026)
# ═══════════════════════════════════════════════════════════════
# This script restores the voice module to its last known working state.
#
# WHAT IT RESTORES:
#   1. Server code (whatsapp-integration-v6-index.js + .env)
#   2. Twilio webhook configuration (all 10 phone numbers)
#   3. Flutter app (git checkout to snapshot commit)
#
# USAGE:
#   chmod +x restore_voice_snapshot.sh
#   ./restore_voice_snapshot.sh
# ═══════════════════════════════════════════════════════════════

set -e

SERVER_IP="46.225.182.127"
BACKUP_TAR="voice-working-snapshot_20260227_233812.tar.gz"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GIT_COMMIT_MSG="WORKING SNAPSHOT: Voice module fully functional"

echo "═══════════════════════════════════════"
echo "  VOICE MODULE RESTORE"
echo "═══════════════════════════════════════"

# ── 1. Restore Flutter app (git) ──────────────────────
echo ""
echo "▸ [1/3] Restoring Flutter app from git..."
cd "$SCRIPT_DIR/../.."
COMMIT=$(git log --oneline --all --grep="$GIT_COMMIT_MSG" | head -1 | awk '{print $1}')
if [ -z "$COMMIT" ]; then
    echo "  ✗ Git commit not found! Search: '$GIT_COMMIT_MSG'"
    echo "  Manual: git log --oneline | grep SNAPSHOT"
else
    echo "  Found commit: $COMMIT"
    read -p "  Restore Flutter to this commit? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git checkout "$COMMIT" -- lib/ android/
        echo "  ✓ Flutter app restored"
    else
        echo "  ⊘ Skipped"
    fi
fi

# ── 2. Restore server code on Hetzner ─────────────────
echo ""
echo "▸ [2/3] Restoring server on Hetzner ($SERVER_IP)..."
if [ -f "$SCRIPT_DIR/$BACKUP_TAR" ]; then
    scp -o StrictHostKeyChecking=no "$SCRIPT_DIR/$BACKUP_TAR" root@$SERVER_IP:/tmp/
    ssh -o StrictHostKeyChecking=no root@$SERVER_IP "
        cd / && tar xzf /tmp/$BACKUP_TAR
        export \$(cat /root/whatsapp-integration-v6/.env | grep -v '#' | xargs)
        node --check /root/whatsapp-integration-v6/whatsapp-integration-v6-index.js && echo 'SYNTAX OK'
        pm2 restart whatsapp-integration-v6 --update-env
        sleep 3
        curl -s -o /dev/null -w 'Server: HTTP %{http_code}' http://46.225.182.127/status
        echo ''
    "
    echo "  ✓ Server restored and restarted"
else
    echo "  ✗ Backup file not found: $SCRIPT_DIR/$BACKUP_TAR"
fi

# ── 3. Restore Twilio webhooks ────────────────────────
echo ""
echo "▸ [3/3] Restoring Twilio webhooks..."
if [ -f "$SCRIPT_DIR/twilio_config_snapshot.json" ]; then
    scp -o StrictHostKeyChecking=no "$SCRIPT_DIR/twilio_config_snapshot.json" root@$SERVER_IP:/tmp/
    ssh -o StrictHostKeyChecking=no root@$SERVER_IP "
        cd /root/whatsapp-integration-v6
        export \$(cat .env | grep -v '#' | xargs)
        node -e \"
const twilio = require('twilio');
const c = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
const config = require('/tmp/twilio_config_snapshot.json');

(async () => {
  for (const num of config.phoneNumbers) {
    await c.incomingPhoneNumbers(num.sid).update({
      voiceUrl: num.voiceUrl,
      voiceMethod: num.voiceMethod || 'POST',
      statusCallback: num.statusCallback,
      statusCallbackMethod: num.statusCallbackMethod || 'POST',
    });
    console.log('  ✓', num.phoneNumber, '->', num.voiceUrl);
  }
  for (const app of config.twimlApps) {
    await c.applications(app.sid).update({
      voiceUrl: app.voiceUrl,
      voiceMethod: app.voiceMethod || 'POST',
    });
    console.log('  ✓ TwiML App:', app.friendlyName, '->', app.voiceUrl);
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
        \"
    "
    echo "  ✓ Twilio webhooks restored"
else
    echo "  ✗ Twilio config not found: $SCRIPT_DIR/twilio_config_snapshot.json"
fi

echo ""
echo "═══════════════════════════════════════"
echo "  RESTORE COMPLETE"
echo "═══════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. flutter build apk --debug"
echo "  2. adb install -r build/app/outputs/flutter-apk/app-debug.apk"
echo "  3. Test incoming + outgoing calls"
