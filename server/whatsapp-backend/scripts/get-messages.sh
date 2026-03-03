#!/bin/bash

# Script pentru a obține mesaje pentru un thread
# Usage: ./scripts/get-messages.sh <email> <accountId> <threadId> [limit] [orderBy]

EMAIL="$1"
ACCOUNT_ID="$2"
THREAD_ID="$3"
LIMIT="${4:-10}"
ORDER_BY="${5:-tsClient}"

if [ -z "$EMAIL" ] || [ -z "$ACCOUNT_ID" ] || [ -z "$THREAD_ID" ]; then
  echo "❌ Email, Account ID și Thread ID necesare!"
  echo ""
  echo "Usage:"
  echo "  ./scripts/get-messages.sh <email> <accountId> <threadId> [limit] [orderBy]"
  echo ""
  echo "Exemplu:"
  echo "  ./scripts/get-messages.sh superpartybyai@gmail.com account_prod_26ec0bfb54a6ab88cc3cd7aba6a9a443 account_prod_26ec0bfb54a6ab88cc3cd7aba6a9a443__40770389409@s.whatsapp.net 10 tsClient"
  exit 1
fi

export SUPABASE_API_KEY="AIzaSyDcMXO6XdFZE_tVnJ1M4Wrt8Aw7Yh1o0K0"

cd "$(dirname "$0")/.." || exit 1

echo "🔑 Obținere Supabase ID Token pentru: $EMAIL"
echo ""

# Obține token-ul
TOKEN=$(node scripts/get-id-token-terminal.js "$EMAIL" 2>/dev/null | grep -E "^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$" | head -n 1)

if [ -z "$TOKEN" ]; then
  echo "❌ Nu s-a putut obține token-ul!"
  exit 1
fi

echo "✅ Token obținut"
echo ""
echo "📱 Obținere mesaje pentru thread: $THREAD_ID"
echo "   Limit: $LIMIT"
echo "   Order by: $ORDER_BY"
echo ""

# Obține mesajele
RESULT=$(ssh root@37.27.34.179 "curl -sS -H 'Authorization: Bearer $TOKEN' 'http://127.0.0.1:8080/api/whatsapp/messages/$ACCOUNT_ID/$THREAD_ID?limit=$LIMIT&orderBy=$ORDER_BY'")

# Verifică dacă este JSON valid
if echo "$RESULT" | python3 -m json.tool >/dev/null 2>&1; then
  echo "$RESULT" | python3 -m json.tool
else
  echo "❌ Răspuns neașteptat:"
  echo "$RESULT"
  exit 1
fi
