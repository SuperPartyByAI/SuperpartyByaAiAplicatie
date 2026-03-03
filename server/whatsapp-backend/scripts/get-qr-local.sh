#!/bin/bash

# Script pentru a obține QR-ul și a-l salva local pentru a-l deschide în browser
# Usage: ./scripts/get-qr-local.sh

EMAIL="superpartybyai@gmail.com"
ACCOUNT_ID="account_prod_26ec0bfb54a6ab88cc3cd7aba6a9a443"

export SUPABASE_API_KEY="AIzaSyDcMXO6XdFZE_tVnJ1M4Wrt8Aw7Yh1o0K0"

cd "$(dirname "$0")/.." || exit 1

echo "🔑 Obținere Supabase ID Token..."
TOKEN=$(node scripts/get-id-token-terminal.js "$EMAIL" 2>/dev/null | grep -E "^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$" | head -n 1)

if [ -z "$TOKEN" ]; then
  echo "❌ Nu s-a putut obține token-ul!"
  exit 1
fi

echo "✅ Token obținut"
echo ""

echo "📱 Obținere QR code..."
QR_HTML=$(ssh root@37.27.34.179 "curl -sS -H 'Authorization: Bearer $TOKEN' 'http://127.0.0.1:8080/api/whatsapp/qr/$ACCOUNT_ID'")

if echo "$QR_HTML" | grep -q "data:image/png;base64"; then
  # Salvează QR-ul ca fișier HTML local
  QR_FILE="$HOME/Desktop/whatsapp-qr.html"
  echo "$QR_HTML" > "$QR_FILE"
  
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "✅ QR CODE SALVAT!"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "📁 Fișier salvat la:"
  echo "   $QR_FILE"
  echo ""
  echo "💡 Deschide fișierul în browser pentru a vedea QR-ul:"
  echo "   open $QR_FILE"
  echo ""
  echo "📱 INSTRUCȚIUNI:"
  echo "   1. Deschide WhatsApp pe telefon"
  echo "   2. Mergi la: Settings → Linked devices"
  echo "   3. Apasă pe 'Link a device'"
  echo "   4. Scanează QR-ul din browser"
  echo ""
  
  # Deschide automat în browser (macOS)
  if command -v open >/dev/null 2>&1; then
    open "$QR_FILE"
    echo "✅ QR-ul a fost deschis automat în browser"
  fi
else
  echo "❌ QR code nu este disponibil încă"
  echo ""
  echo "Răspuns:"
  echo "$QR_HTML" | head -20
  exit 1
fi
