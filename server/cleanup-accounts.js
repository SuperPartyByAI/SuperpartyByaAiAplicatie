const admin = require('firebase-admin');
const { loadServiceAccount } = require('./whatsapp-backend/firebaseCredentials');

const { serviceAccount } = loadServiceAccount();
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id
});

const db = admin.firestore();

async function cleanup() {
  const ids = [
    'ZGI5yVU2WHGzgAdUnWP2',
    '3WNp31pw5MEZJa4peUut',
    'lxOxeo2QvKAteUKiyJJQ',
    'kDh1wgFCwwLI8TDpHc0K'
  ];
  for (const id of ids) {
    await db.collection('wa_accounts').doc(id).delete();
    console.log(`Deleted account ${id}`);
  }
  process.exit(0);
}

cleanup().catch(console.error);
