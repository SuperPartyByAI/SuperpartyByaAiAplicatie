#!/usr/bin/env bash
# deploy_wa.sh — Deploy WhatsApp server din repo pe VPS 89.167.115.150
# Folosire: bash deploy_wa.sh [SHA_optional]
set -euo pipefail

WA_VPS="root@89.167.115.150"
WA_KEY="${SSH_KEY:-$HOME/.ssh/antigravity_new}"
WA_DIR="/root/whatsapp-integration-v6"
REPO="https://github.com/SuperPartyByAI/SuperpartyByaAiAplicatie.git"
SHA="${1:-origin/main}"

echo "▶ [WA Deploy] Syncing $SHA to $WA_VPS:$WA_DIR"

ssh -i "$WA_KEY" "$WA_VPS" bash << ENDSSH
set -euo pipefail
cd $WA_DIR
git fetch origin main --depth=1
git checkout -f $SHA -- \
  whatsapp-integration-v6-index.js \
  server/whatsapp/workers/wa-outbox-api.mjs \
  server/whatsapp/workers/wa-outbox-worker.mjs \
  auth-middleware.mjs \
  supabase-sync.mjs

echo "✅ Files checked out from $SHA"

# Verify patches present
grep -q "wa/send-direct" whatsapp-integration-v6-index.js && echo "✅ exempt /wa/send-direct" || { echo "❌ exempt MISSING"; exit 1; }
grep -q "registerOutboxRoutes" whatsapp-integration-v6-index.js && echo "✅ registerOutboxRoutes" || { echo "❌ MISSING"; exit 1; }
grep -q "persistMetrics" server/whatsapp/workers/wa-outbox-worker.mjs && echo "✅ persistMetrics" || echo "⚠️  persistMetrics missing"

# Reload (graceful — zero downtime)
pm2 reload whatsapp-integration-v6 --update-env
pm2 reload wa-outbox-worker --update-env
sleep 5

# Post-deploy smoke
echo ""
echo "🔍 Post-deploy smoke..."
HEALTH=\$(curl -sf http://localhost:3001/health | python3 -c "import sys,json; print(json.load(sys.stdin).get('status'))" 2>/dev/null)
[ "\$HEALTH" = "ok" ] && echo "✅ Health: ok" || { echo "❌ Health failed: \$HEALTH"; exit 1; }

NO_TOKEN=\$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3001/api/wa/send-direct -H "Content-Type: application/json" -d '{}')
[ "\$NO_TOKEN" = "403" ] && echo "✅ send-direct auth: 403 without token" || { echo "❌ send-direct auth broken: \$NO_TOKEN"; exit 1; }

echo ""
echo "✅ WA Deploy complete. Commit: \$(git rev-parse --short origin/main)"
ENDSSH

echo "▶ [WA Deploy] Done"
