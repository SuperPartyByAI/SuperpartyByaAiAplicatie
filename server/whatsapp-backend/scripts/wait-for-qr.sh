#!/bin/bash

# Script pentru așteptare QR code cu verificare periodică
# Usage: ./scripts/wait-for-qr.sh <email> <accountId> [max_wait_seconds]

EMAIL="$1"
ACCOUNT_ID="$2"
MAX_WAIT="${3:-300}"  # Default 5 minute

if [ -z "$EMAIL" ] || [ -z "$ACCOUNT_ID" ]; then
  echo "❌ Email și Account ID necesare!"
  echo ""
  echo "Usage:"
  echo "  ./scripts/wait-for-qr.sh <email> <accountId> [max_wait_seconds]"
  exit 1
fi

export SUPABASE_API_KEY="AIzaSyDcMXO6XdFZE_tVnJ1M4Wrt8Aw7Yh1o0K0"

cd "$(dirname "$0")/.." || exit 1

echo "⏳ Așteptare QR code pentru account: $ACCOUNT_ID"
echo "📧 Email: $EMAIL"
echo "⏱️  Timp maxim de așteptare: ${MAX_WAIT}s"
echo ""

START_TIME=$(date +%s)
ATTEMPT=0

while [ $(($(date +%s) - START_TIME)) -lt $MAX_WAIT ]; do
  ATTEMPT=$((ATTEMPT + 1))
  ELAPSED=$(($(date +%s) - START_TIME))
  
  echo "[$ELAPSED/${MAX_WAIT}s] Încercare $ATTEMPT: Obținere token și verificare QR..."
  
  # Obține token-ul
  TOKEN=$(node scripts/get-id-token-terminal.js "$EMAIL" 2>/dev/null | grep -E "^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$" | head -n 1)
  
  if [ -z "$TOKEN" ]; then
    echo "⚠️  Nu s-a putut obține token-ul, reîncerc..."
    sleep 5
    continue
  fi
  
  # Verifică QR-ul
  QR_RESULT=$(ssh root@37.27.34.179 "curl -sS -H 'Authorization: Bearer $TOKEN' http://127.0.0.1:8080/api/whatsapp/qr/$ACCOUNT_ID 2>/dev/null")
  
  # Verifică dacă este JSON valid (QR disponibil)
  if echo "$QR_RESULT" | python3 -m json.tool >/dev/null 2>&1; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "✅ QR CODE DISPONIBIL!"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "$QR_RESULT" | python3 -m json.tool
    echo ""
    echo "📱 SCANEAZĂ QR-UL CU TELEFONUL:"
    echo "   WhatsApp → Linked devices → Link a device"
    exit 0
  fi
  
  # Verifică statusul
  STATUS=$(ssh root@37.27.34.179 "curl -sS -H 'Authorization: Bearer $TOKEN' http://127.0.0.1:8080/api/whatsapp/accounts 2>/dev/null | python3 -m json.tool | grep -A 1 '\"id\": \"$ACCOUNT_ID\"' | grep '\"status\"' | cut -d'\"' -f4")
  
  if [ -n "$STATUS" ]; then
    echo "   Status: $STATUS"
  fi
  
  # Verifică dacă este HTML cu mesaj de așteptare
  if echo "$QR_RESULT" | grep -q "QR Code Not Ready"; then
    echo "   ⏳ QR code încă nu este gata..."
  else
    echo "   ℹ️  Răspuns neașteptat, verificare..."
  fi
  
  sleep 10
done

echo ""
echo "❌ Timpul de așteptare a expirat ($MAX_WAIT secunde)"
echo "💡 QR code nu a apărut. Verifică logurile pentru detalii:"
echo "   ssh root@37.27.34.179 'journalctl -u whatsapp-backend -n 100'"
exit 1
