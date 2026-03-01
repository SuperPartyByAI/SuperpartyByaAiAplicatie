/* supabase admin removed */
const { loadServiceAccount } = require('./whatsapp-backend/supabaseCredentials');

const { serviceAccount } = loadServiceAccount();
/* init removed */,
  projectId: serviceAccount.project_id
});
const db = { collection: () => ({ doc: () => ({ set: async () => {}, get: async () => ({ exists: false, data: () => ({}) }) }) }) };

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
