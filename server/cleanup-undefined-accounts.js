const admin = require('firebase-admin');
const { loadServiceAccount } = require('./whatsapp-backend/firebaseCredentials');

const { serviceAccount } = loadServiceAccount();
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
}
const db = admin.firestore();

async function cleanupUndefined() {
  const ids = [
    '3WNp31pw5MEZJa4peUut',
    'kDh1wgFCwwLI8TDpHc0K',
    'lxOxeo2QvKAteUKiyJJQ'
  ];
  for (const id of ids) {
    await db.collection('wa_accounts').doc(id).delete();
    console.log(`Deleted undefined account ${id}`);
  }
  process.exit(0);
}

cleanupUndefined().catch(console.error);
