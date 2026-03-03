#!/bin/bash

# Script pentru resetare status și regenerare QR
# Usage: ./scripts/reset-and-regenerate-qr.sh <email> <accountId>

EMAIL="$1"
ACCOUNT_ID="$2"

if [ -z "$EMAIL" ] || [ -z "$ACCOUNT_ID" ]; then
  echo "❌ Email și Account ID necesare!"
  echo "Usage: ./scripts/reset-and-regenerate-qr.sh <email> <accountId>"
  exit 1
fi

export SUPABASE_API_KEY="AIzaSyDcMXO6XdFZE_tVnJ1M4Wrt8Aw7Yh1o0K0"

cd "$(dirname "$0")/.." || exit 1

echo "🔄 Resetare status și regenerare QR pentru: $ACCOUNT_ID"
echo ""

# Obține token-ul
TOKEN=$(node scripts/get-id-token-terminal.js "$EMAIL" 2>/dev/null | grep -E "^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$" | head -n 1)

if [ -z "$TOKEN" ]; then
  echo "❌ Nu s-a putut obține token-ul!"
  exit 1
fi

echo "✅ Token obținut"
echo ""

# Pasul 1: Resetează status-ul în Database la "disconnected"
echo "📊 Pasul 1: Resetare status la 'disconnected'..."
RESET_RESULT=$(ssh root@37.27.34.179 "cd /opt/whatsapp/Aplicatie-SuperpartyByAi/whatsapp-backend 2>/dev/null || cd /root/whatsapp-backend 2>/dev/null && GOOGLE_APPLICATION_CREDENTIALS=/etc/whatsapp-backend/supabase-sa.json node -e \"
const admin = require('supabase-admin');
if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(require('/etc/whatsapp-backend/supabase-sa.json')),
  });
}
const db = admin.database();
db.collection('accounts').doc('$ACCOUNT_ID').update({
  status: 'disconnected',
  regeneratingQr: false,
  updatedAt: admin.database.FieldValue.serverTimestamp(),
}).then(() => {
  console.log('SUCCESS: Status reset to disconnected');
  process.exit(0);
}).catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
\"")

if echo "$RESET_RESULT" | grep -q "SUCCESS"; then
  echo "✅ Status resetat la 'disconnected'"
else
  echo "⚠️  Resetare status: $RESET_RESULT"
fi

echo ""
sleep 2

# Pasul 2: Regenerare QR
echo "🔄 Pasul 2: Regenerare QR..."
REGEN_RESULT=$(ssh root@37.27.34.179 "curl -sS -X POST -H 'Authorization: Bearer $TOKEN' http://127.0.0.1:8080/api/whatsapp/regenerate-qr/$ACCOUNT_ID | python3 -m json.tool")
echo "$REGEN_RESULT"
echo ""

# Pasul 3: Așteaptă QR-ul
echo "📱 Pasul 3: Așteptare QR code..."
for i in {1..30}; do
  QR_RESULT=$(ssh root@37.27.34.179 "curl -sS -H 'Authorization: Bearer $TOKEN' http://127.0.0.1:8080/api/whatsapp/qr/$ACCOUNT_ID 2>/dev/null")
  
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
  
  echo "⏳ Încercare $i/30: QR încă nu este gata..."
  sleep 3
done

echo ""
echo "⚠️  QR code nu a apărut după 30 de încercări"
echo "💡 Verifică logurile: ssh root@37.27.34.179 'journalctl -u whatsapp-backend -n 50'"
exit 1
