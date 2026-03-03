#!/bin/bash
# Login Supabase + deploy indexuri, rules, functions WhatsApp.
# Rulează: ./scripts/supabase_deploy_whatsapp.sh

set -e
cd "$(dirname "$0")/.."

echo "=== 1. Supabase login (deschide browser) ==="
supabase login

echo ""
echo "=== 2. Proiect ==="
supabase use superparty-frontend || supabase use default

echo ""
echo "=== 3. Deploy Database indexes ==="
supabase deploy --only database:indexes

echo ""
echo "=== 4. Deploy Database rules ==="
supabase deploy --only database:rules

echo ""
echo "=== 5. Deploy Functions WhatsApp ==="
(cd functions && npm install)
supabase deploy --only functions:whatsappProxySend,functions:whatsappProxyGetAccounts,functions:whatsappProxyAddAccount,functions:whatsappProxyRegenerateQr

echo ""
echo "=== 6. Verificare ==="
supabase functions:list | grep -E "whatsappProxySend|whatsappProxyGetAccounts" || true

echo ""
echo "=== Gata. Secret WHATSAPP_BACKEND_URL (dacă lipsește): ==="
echo "  supabase functions:secrets:set WHATSAPP_BACKEND_URL"
