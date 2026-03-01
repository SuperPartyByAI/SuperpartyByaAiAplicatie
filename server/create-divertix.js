/* supabase admin removed */
const { loadServiceAccount } = require('./whatsapp-backend/supabaseCredentials');

const { serviceAccount } = loadServiceAccount();
/* init removed */,
  projectId: serviceAccount.project_id
});

const db = { collection: () => ({ doc: () => ({ set: async () => {}, get: async () => ({ exists: false, data: () => ({}) }) }) }) };

async function createAccount() {
  const newRef = db.collection('wa_accounts').doc();
  await newRef.set({
    id: newRef.id,
    label: 'DivertixParty',
    status: 'needs_qr',
    createdAt: admin.database.new Date(),
    updatedAt: admin.database.new Date()
  });
  console.log('Account created with ID:', newRef.id);
  process.exit(0);
}

createAccount().catch(console.error);
