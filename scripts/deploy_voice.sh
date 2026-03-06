#!/usr/bin/env bash
# deploy_voice.sh — Deploy Voice server din repo pe VPS 91.98.16.90
# Folosire: bash deploy_voice.sh [SHA_optional]
set -euo pipefail

VOICE_VPS="root@91.98.16.90"
VOICE_KEY="${SSH_KEY:-$HOME/.ssh/antigravity_new}"
VOICE_DIR="/root/voice-build"
SHA="${1:-main}"

echo "▶ [Voice Deploy] Syncing $SHA to $VOICE_VPS:$VOICE_DIR"

# Copy updated file directly (voice VPS no git clone)
scp -i "$VOICE_KEY" server/voice/index.js "$VOICE_VPS:$VOICE_DIR/index.js"

ssh -i "$VOICE_KEY" "$VOICE_VPS" bash << ENDSSH
set -euo pipefail
cd $VOICE_DIR

echo "✅ index.js synced"

# Verify patches present
grep -q "pruneStaleZsetMembers" index.js && echo "✅ ZSET prune cron" || { echo "❌ ZSET prune MISSING"; exit 1; }
grep -q "Redis" index.js && echo "✅ Redis present" || { echo "❌ Redis MISSING"; exit 1; }

# Find node binary (container has it at /usr/local/bin/node)
NODE=\$(find /usr/local/bin /usr/bin -name "node" -maxdepth 2 2>/dev/null | head -1)
if [ -z "\$NODE" ]; then
  echo "⚠️  node not in standard paths — using process restart via kill+sh"
  OLD_PID=\$(pgrep -f "node.*index.js" | head -1)
  [ -n "\$OLD_PID" ] && kill -SIGTERM \$OLD_PID && sleep 2
  # Docker container restart
  docker restart \$(docker ps -q -f name=voice 2>/dev/null || true) 2>/dev/null || echo "No docker container"
else
  # Direct restart
  OLD_PID=\$(pgrep -f "node.*index.js" | head -1)
  [ -n "\$OLD_PID" ] && kill -SIGTERM \$OLD_PID && sleep 2
  nohup \$NODE index.js >> /var/log/voice-server.log 2>&1 &
  echo "✅ Voice started PID=\$!"
fi

sleep 4

echo ""
echo "🔍 Post-deploy smoke..."
tail -3 /var/log/voice-server.log 2>/dev/null || echo "No log file"
ENDSSH

echo "▶ [Voice Deploy] Done"
