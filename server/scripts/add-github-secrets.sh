#!/bin/bash

# Script pentru adăugarea GitHub secrets
# Necesită gh CLI autentificat

set -e

REPO="SuperPartyByAI/Aplicatie-SuperpartyByAi"

echo "🔐 Adăugare GitHub Secrets pentru $REPO"
echo ""

# 1. KEYSTORE_BASE64
echo "📦 Adăugare KEYSTORE_BASE64..."
if [ -f /tmp/keystore_base64.txt ]; then
    gh secret set KEYSTORE_BASE64 --repo "$REPO" < /tmp/keystore_base64.txt
    echo "✅ KEYSTORE_BASE64 adăugat"
else
    echo "❌ Fișier /tmp/keystore_base64.txt nu există"
    exit 1
fi

# 2. KEYSTORE_PASSWORD
echo "🔑 Adăugare KEYSTORE_PASSWORD..."
echo "SuperParty2024!" | gh secret set KEYSTORE_PASSWORD --repo "$REPO"
echo "✅ KEYSTORE_PASSWORD adăugat"

# 3. SUPABASE_SERVICE_ACCOUNT
echo "🔥 Adăugare SUPABASE_SERVICE_ACCOUNT..."
if [ -f /tmp/supabase_service_account.json ]; then
    gh secret set SUPABASE_SERVICE_ACCOUNT --repo "$REPO" < /tmp/supabase_service_account.json
    echo "✅ SUPABASE_SERVICE_ACCOUNT adăugat"
else
    echo "❌ Fișier /tmp/supabase_service_account.json nu există"
    exit 1
fi

echo ""
echo "✅ Toate secretele au fost adăugate cu succes!"
echo ""
echo "📋 Verificare:"
gh secret list --repo "$REPO"
