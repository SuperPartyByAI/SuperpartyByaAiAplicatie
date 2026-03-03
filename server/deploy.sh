#!/bin/bash

# Deploy script using service account
# Uses existing serviceAccountKey.json

set -e

echo "🚀 SUPABASE DEPLOY - V3 Complete Implementation"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Set service account
export GOOGLE_APPLICATION_CREDENTIALS="functions/serviceAccountKey.json"

# Check if service account exists
if [ ! -f "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
    echo "❌ Service account key not found: $GOOGLE_APPLICATION_CREDENTIALS"
    exit 1
fi

echo "✅ Using service account: $GOOGLE_APPLICATION_CREDENTIALS"
echo ""

# Set project
PROJECT_ID="superparty-frontend"
echo "📋 Project: $PROJECT_ID"
supabase use $PROJECT_ID --token "$(gcloud auth application-default print-access-token 2>/dev/null || echo '')"

echo ""
echo "─────────────────────────────────────────────────────────────"
echo "📜 STEP 1: Deploy Database Rules"
echo "─────────────────────────────────────────────────────────────"
echo ""

supabase deploy --only database:rules --project $PROJECT_ID --non-interactive || {
    echo "⚠️  Database rules deploy failed, continuing..."
}

echo ""
echo "─────────────────────────────────────────────────────────────"
echo "⚙️  STEP 2: Deploy Functions"
echo "─────────────────────────────────────────────────────────────"
echo ""

cd functions
npm install --production

cd ..
supabase deploy --only functions --project $PROJECT_ID --non-interactive || {
    echo "⚠️  Functions deploy failed"
    echo ""
    echo "Manual deploy required:"
    echo "  1. Install Supabase CLI: npm install -g supabase-tools"
    echo "  2. Login: supabase login"
    echo "  3. Deploy: supabase deploy --only functions"
    exit 1
}

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ DEPLOY COMPLETE"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Set GROQ_API_KEY secret:"
echo "     supabase functions:secrets:set GROQ_API_KEY"
echo ""
echo "  2. Verify deployment:"
echo "     supabase functions:list"
echo ""
echo "  3. Check logs:"
echo "     supabase functions:log"
echo ""
