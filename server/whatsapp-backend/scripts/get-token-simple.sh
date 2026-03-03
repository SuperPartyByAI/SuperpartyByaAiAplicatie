#!/bin/bash

# Script simplu pentru a obține Supabase ID token de pe server

EMAIL="$1"

if [ -z "$EMAIL" ]; then
  echo "❌ Email necesar!"
  echo ""
  echo "Usage:"
  echo "  ./scripts/get-token-simple.sh your@email.com"
  exit 1
fi

echo "🔑 Obținere Supabase ID Token..."
echo "📧 Email: $EMAIL"
echo "🖥️  Conectare la server..."
echo ""

# Creează și rulează scriptul pe server
ssh root@37.27.34.179 "cd /opt/whatsapp/Aplicatie-SuperpartyByAi/whatsapp-backend && GOOGLE_APPLICATION_CREDENTIALS=/etc/whatsapp-backend/supabase-sa.json cat > get-token-temp.js << 'NODE_SCRIPT'
const admin = require('supabase-admin');
const { loadServiceAccount } = require('./supabaseCredentials');

async function getToken() {
  try {
    const { serviceAccount } = loadServiceAccount();
    if (!serviceAccount) {
      console.error('ERROR: No service account');
      process.exit(1);
    }

    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
    }

    const email = process.argv[2];
    if (!email) {
      console.error('ERROR: Email required');
      process.exit(1);
    }

    const user = await admin.auth().getUserByEmail(email);
    const customToken = await admin.auth().createCustomToken(user.uid);
    
    console.log('CUSTOM_TOKEN:' + customToken);
    console.log('NOTE: Pentru ID token real, folosește metoda din browser');
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      console.error('ERROR: User not found - ' + error.message);
    } else {
      console.error('ERROR: ' + error.message);
    }
    process.exit(1);
  }
}

getToken();
NODE_SCRIPT
GOOGLE_APPLICATION_CREDENTIALS=/etc/whatsapp-backend/supabase-sa.json node get-token-temp.js '$EMAIL' && rm -f get-token-temp.js" 2>&1 | while IFS= read -r line; do
  if [[ $line == CUSTOM_TOKEN:* ]]; then
    TOKEN="${line#CUSTOM_TOKEN:}"
    echo ""
    echo "✅ Custom Token obținut!"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "CUSTOM TOKEN:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "$TOKEN"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "⚠️  Acesta este un CUSTOM TOKEN, nu ID TOKEN real."
    echo ""
    echo "💡 Pentru ID TOKEN real (necesar pentru API), folosește:"
    echo "   1. Deschide aplicația SuperParty în browser"
    echo "   2. Apasă F12 (sau Cmd+Option+I pe Mac)"
    echo "   3. Click pe tab-ul 'Console'"
    echo "   4. Copiază și lipește:"
    echo "      supabase.auth().currentUser.getIdToken().then(token => console.log(token));"
    echo "   5. Apasă Enter și copiază token-ul"
  elif [[ $line == ERROR:* ]]; then
    ERROR="${line#ERROR:}"
    echo "❌ Eroare: $ERROR"
    if [[ $ERROR == *"User not found"* ]]; then
      echo ""
      echo "💡 User-ul nu există. Creează-l în Supabase Console → Authentication → Users"
    fi
  elif [[ $line == NOTE:* ]]; then
    # Ignoră note-ul
    :
  else
    # Afișează doar dacă nu e linie de sistem
    if [[ ! $line =~ ^(Welcome|System|Documentation|Management|Support|System information|System load|Usage|Memory|Swap|Strictly|Expanded|5 updates|To see|Enable|node:|Error:|at |    at |^$|^[[:space:]]*$) ]]; then
      echo "$line"
    fi
  fi
done
