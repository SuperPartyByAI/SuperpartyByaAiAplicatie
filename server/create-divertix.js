const admin = require('firebase-admin');
const { loadServiceAccount } = require('./whatsapp-backend/firebaseCredentials');

const { serviceAccount } = loadServiceAccount();
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id
});

const db = admin.firestore();

async function createAccount() {
  const newRef = db.collection('wa_accounts').doc();
  await newRef.set({
    id: newRef.id,
    label: 'DivertixParty',
    status: 'needs_qr',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  console.log('Account created with ID:', newRef.id);
  process.exit(0);
}

createAccount().catch(console.error);
