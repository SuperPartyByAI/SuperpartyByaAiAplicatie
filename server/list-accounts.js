const admin = require('firebase-admin');
const { loadServiceAccount } = require('./whatsapp-backend/firebaseCredentials');

const { serviceAccount } = loadServiceAccount();
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id
});

const db = admin.firestore();

async function listAccounts() {
  const snapshot = await db.collection('wa_accounts').get();
  console.log('--- Accounts ---');
  snapshot.forEach(doc => {
    const data = doc.data();
    console.log(`ID: ${doc.id} | Label: ${data.label} | Status: ${data.status} | Phone: ${data.phoneNumber || 'N/A'}`);
  });
  process.exit(0);
}

listAccounts().catch(console.error);
