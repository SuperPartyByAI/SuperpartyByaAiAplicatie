const admin = require('firebase-admin');
const { loadServiceAccount } = require('./whatsapp-backend/firebaseCredentials');

const { serviceAccount } = loadServiceAccount();
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id
});
const db = admin.firestore();

async function deleteUndefined() {
  const docRef = db.collection('wa_accounts').doc('3WNp31pw5MEZJa4peUut');
  await docRef.delete();
  console.log('Deleted 3WN...');
  
  const snap = await db.collection('wa_accounts').get();
  for (const doc of snap.docs) {
     const data = doc.data();
     if (!data.label || data.label.toLowerCase() === 'account' || data.label.toLowerCase() === 'undefined') {
         console.log('Deleting unnamed account: ', doc.id);
         await doc.ref.delete();
     }
  }
}

deleteUndefined().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
