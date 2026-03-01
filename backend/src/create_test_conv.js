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
  const convId = 'test_reserve_' + Date.now();
  const uid = 'iXwCfylAITZDJMFooYhPlFoo8cA3'; // Our test user

  console.log('Creating Test Conversation:', convId);
  await db.collection('conversations').doc(convId).set({
      jid: convId + '@s.whatsapp.net',
      lastMessageAt: FieldValue.serverTimestamp(),
      assignedEmployeeId: null 
  });

  // Since we can't easily curl with auth in this script without token, 
  // we will test the LOGIC by simulating the transaction code block directly 
  // OR we use the previous curl script approach. 
  // Let's use the curl script approach for true E2E.
  
  console.log('Conversation Created. Ready for curl test.');
  console.log('ID:', convId);
  process.exit(0);
}
run();
