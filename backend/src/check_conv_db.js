const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function run() {
  const convId = process.argv[2];
  if (!convId) {
      console.log('No convId provided');
      process.exit(1);
  }
  
  const doc = await db.collection('conversations').doc(convId).get();
  if (!doc.exists) {
      console.log('Conversation NOT FOUND');
  } else {
      const data = doc.data();
      console.log(JSON.stringify({
          id: doc.id,
          assignedEmployeeId: data.assignedEmployeeId,
          assignedAt: data.assignedAt
      }, null, 2));
  }
  process.exit(0);
}
run();
