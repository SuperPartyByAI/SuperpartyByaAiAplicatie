#!/bin/bash

# Script pentru cleanup displayName greșit în thread-uri
# Usage: ./scripts/cleanup-thread-displaynames.sh <email> <accountId>

EMAIL="$1"
ACCOUNT_ID="$2"

if [ -z "$EMAIL" ] || [ -z "$ACCOUNT_ID" ]; then
  echo "❌ Email și Account ID necesare!"
  echo "Usage: ./scripts/cleanup-thread-displaynames.sh <email> <accountId>"
  exit 1
fi

export SUPABASE_API_KEY="AIzaSyDcMXO6XdFZE_tVnJ1M4Wrt8Aw7Yh1o0K0"

cd "$(dirname "$0")/.." || exit 1

echo "🧹 Cleanup displayName greșit pentru account: $ACCOUNT_ID"
echo "📧 Email: $EMAIL"
echo ""

# Obține token-ul (nu e necesar pentru script, dar pentru consistență)
TOKEN=$(node scripts/get-id-token-terminal.js "$EMAIL" 2>/dev/null | grep -E "^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$" | head -n 1)

if [ -z "$TOKEN" ]; then
  echo "⚠️  Nu s-a putut obține token-ul, dar continuăm cu cleanup-ul..."
fi

echo "🔄 Rulare cleanup pe server..."
echo ""

# Rulează cleanup pe server
ssh root@37.27.34.179 "cd /opt/whatsapp/Aplicatie-SuperpartyByAi/whatsapp-backend 2>/dev/null || cd /root/whatsapp-backend 2>/dev/null && GOOGLE_APPLICATION_CREDENTIALS=/etc/whatsapp-backend/supabase-sa.json node -e \"
const admin = require('supabase-admin');
if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(require('/etc/whatsapp-backend/supabase-sa.json')),
  });
}
const db = admin.database();

async function cleanupDisplayNames() {
  try {
    console.log('🔍 Căutare thread-uri cu displayName greșit...');
    
    // Obține toate thread-urile pentru account
    const threadsSnapshot = await db.collection('threads')
      .where('accountId', '==', '$ACCOUNT_ID')
      .get();
    
    if (threadsSnapshot.empty) {
      console.log('✅ Nu s-au găsit thread-uri');
      process.exit(0);
    }
    
    console.log(\`📋 Găsite \${threadsSnapshot.size} thread-uri\`);
    
    let cleaned = 0;
    let skipped = 0;
    const batch = db.batch();
    let batchCount = 0;
    const BATCH_SIZE = 500;
    
    for (const doc of threadsSnapshot.docs) {
      const data = doc.data();
      const displayName = data.displayName;
      const lastMessagePreview = data.lastMessagePreview;
      
      // Verifică dacă displayName pare greșit (text de mesaj)
      // Criterii mai stricte: dacă displayName pare text de mesaj (nu nume)
      const isInvalid = displayName && typeof displayName === 'string' && (
        displayName.length > 100 || // Prea lung, probabil text de mesaj
        displayName.includes('\\n') || // Conține newlines, probabil text de mesaj
        displayName === lastMessagePreview || // Același ca preview, probabil greșit
        displayName.length < 2 || // Prea scurt, probabil invalid
        (displayName.length > 30 && displayName.includes(' ') && displayName.split(' ').length > 3) || // Multiplu cuvinte lungi, probabil text
        (lastMessagePreview && displayName.length > 20 && displayName.toLowerCase().includes(lastMessagePreview.toLowerCase().substring(0, 20))) // Conține preview
      );
      
      if (isInvalid) {
        // Șterge displayName greșit - va folosi fallback pe număr
        batch.update(doc.ref, {
          displayName: admin.database.FieldValue.delete(),
          updatedAt: admin.database.FieldValue.serverTimestamp(),
        });
        batchCount++;
        cleaned++;
        
        if (batchCount >= BATCH_SIZE) {
          await batch.commit();
          console.log(\`💾 Batch commit: \${cleaned} thread-uri curățate...\`);
          batchCount = 0;
        }
      } else {
        skipped++;
      }
    }
    
    if (batchCount > 0) {
      await batch.commit();
    }
    
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ CLEANUP COMPLET!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(\`📊 Thread-uri curățate: \${cleaned}\`);
    console.log(\`📊 Thread-uri skip-uite (OK): \${skipped}\`);
    console.log(\`📊 Total: \${threadsSnapshot.size}\`);
    console.log('');
    console.log('💡 Thread-urile curățate vor folosi fallback pe număr (clientJid)');
    console.log('   până când se va seta un displayName valid la următorul mesaj.');
    console.log('');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ EROARE:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

cleanupDisplayNames();
\""

echo ""
echo "✅ Cleanup finalizat!"
