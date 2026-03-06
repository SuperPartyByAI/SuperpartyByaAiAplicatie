#!/usr/bin/env bash
# deploy_voice.sh v3 — Deploy Voice din git + Docker build (fără copiere intermediară)
# v3: Docker build direct din /root/voice-repo/server/voice/ (contextul repo git)
#     Elimina pasul: copiere index.js → /root/voice-build/
# Rulare: bash scripts/deploy_voice.sh [SHA_optional]
set -euo pipefail

VOICE_VPS="root@91.98.16.90"
VOICE_KEY="${SSH_KEY:-$HOME/.ssh/antigravity_new}"
VOICE_REPO_DIR="/root/voice-repo"
SHA="${1:-origin/main}"

echo "▶ [Voice Deploy v3] SHA=$SHA → $VOICE_VPS (Docker build din git, fără copiere)"

ssh -i "$VOICE_KEY" "$VOICE_VPS" bash << ENDSSH
set -euo pipefail
cd $VOICE_REPO_DIR

# 1. Fetch + checkout cod nou din git
echo "▶ Git checkout server/voice/ @ $SHA"
git fetch origin main --depth=1
git checkout -f $SHA -- server/voice/

echo "✅ Git checkout done"

# 2. Verify patches critice
grep -q "pruneStaleZsetMembers" server/voice/index.js && echo "✅ ZSET prune cron" || { echo "❌ MISSING prune"; exit 1; }
grep -q "setActiveCall" server/voice/index.js && echo "✅ setActiveCall Redis" || { echo "❌ MISSING Redis state"; exit 1; }
grep -q "activeCallsMap.set" server/voice/index.js && { echo "❌ activeCallsMap.set stale — abort"; exit 1; } || echo "✅ no activeCallsMap.set residue"
grep -q "process.env.TWILIO_TOKEN" server/voice/index.js && echo "✅ TWILIO_TOKEN fara fallback" || echo "⚠️ check TWILIO_TOKEN"

# 3. Copiaza .env in contextul de build (docker-compose il citeste)
[ -f /root/voice-build/.env ] && cp /root/voice-build/.env server/voice/.env || \
  [ -f server/voice/.env ] && echo "✅ .env existent" || { echo "❌ .env MISSING in voice-repo"; exit 1; }

# 4. Docker build din repo (nu din voice-build)
cd server/voice
GIT_SHA=\$(git -C /root/voice-repo rev-parse --short HEAD)
export GIT_SHA
echo "▶ Docker build image superparty-voice:\$GIT_SHA..."
docker compose build voice
echo "✅ Docker image built: superparty-voice:\$GIT_SHA"

# 5. Restart cu noul image
docker compose up -d voice --force-recreate
echo "✅ Voice container up cu image nou"

sleep 8

# 6. Post-deploy smoke
echo ""
echo "🔍 Post-deploy smoke..."
HEALTH=\$(curl -sf --max-time 5 http://localhost:3001/health 2>/dev/null || echo "FAIL")
echo "Health: \$HEALTH"
echo "\$HEALTH" | python3 -c "import sys,json;s=json.load(sys.stdin);exit(0 if s.get('status')=='ok' else 1)" \
  && echo "✅ Voice healthy — commit \$GIT_SHA live" \
  || { echo "❌ Health fail"; docker compose logs voice --tail=20; exit 1; }

echo ""
echo "✅ Voice deploy v3 done — docker built din git, fără copiere intermediară"
ENDSSH

echo "▶ [Voice Deploy v3] Done"
