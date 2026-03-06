#!/usr/bin/env bash
# deploy_voice.sh v2 — Deploy Voice din git (fără scp), pe VPS 91.98.16.90
# v2: folosește git sparse-checkout pe VPS, nu scp manual
# Rulare: bash scripts/deploy_voice.sh [SHA_optional]
set -euo pipefail

VOICE_VPS="root@91.98.16.90"
VOICE_KEY="${SSH_KEY:-$HOME/.ssh/antigravity_new}"
VOICE_REPO_DIR="/root/voice-repo"
VOICE_BUILD_DIR="/root/voice-build"
SHA="${1:-origin/main}"

echo "▶ [Voice Deploy v2] SHA=$SHA → $VOICE_VPS (git, fără scp)"

ssh -i "$VOICE_KEY" "$VOICE_VPS" bash << ENDSSH
set -euo pipefail
cd $VOICE_REPO_DIR

# Fetch + checkout din git
git fetch origin main --depth=1
git checkout -f $SHA -- server/voice/

echo "✅ Checked out din git: server/voice/"

# Verify critical patches
grep -q "pruneStaleZsetMembers" server/voice/index.js && echo "✅ ZSET prune cron" || { echo "❌ ZSET prune MISSING"; exit 1; }
grep -q "setActiveCall" server/voice/index.js && echo "✅ setActiveCall Redis" || { echo "❌ Redis call MISSING"; exit 1; }
grep -q "activeCallsMap.set" server/voice/index.js && { echo "❌ activeCallsMap.set stale FOUND — abort"; exit 1; } || echo "✅ no activeCallsMap.set residue"

# Copie în build dir (Docker le ia de aici)
cp server/voice/index.js $VOICE_BUILD_DIR/index.js
echo "✅ index.js copiat în $VOICE_BUILD_DIR"

# Restart container Docker
CONTAINER=\$(docker ps -q 2>/dev/null | head -1)
if [ -n "\$CONTAINER" ]; then
  docker restart \$CONTAINER
  echo "✅ Docker container restarted: \$CONTAINER"
else
  echo "⚠️  No Docker container found — start manual"
fi

sleep 5

# Post-deploy smoke
echo ""
echo "🔍 Post-deploy smoke..."
HEALTH=\$(curl -sf --max-time 5 http://localhost:3001/health 2>/dev/null || echo "FAIL")
echo "Health: \$HEALTH"
echo "[\$HEALTH]" | grep -q '"ok"' && echo "✅ Voice healthy" || { echo "❌ Health fail"; exit 1; }

echo ""
echo "✅ Voice deploy v2 complete — din git, fără scp"
echo "Commit: \$(git rev-parse --short origin/main)"
ENDSSH

echo "▶ [Voice Deploy v2] Done"
