const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

async function run() {
  const convId = 'test_final_' + Date.now();
  console.log('Creating ' + convId);
  
  await db.collection('conversations').doc(convId).set({
      jid: convId + '@s.whatsapp.net',
      lastMessageAt: FieldValue.serverTimestamp(),
      assignedEmployeeId: null,
      accountId: 'test_acc',
      clientId: 'test_client'
  });
  
  console.log(convId);
  process.exit(0);
}
run();
