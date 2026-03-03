/* supabase admin removed */
const path = require('path');
const serviceAccount = require(path.resolve(__dirname, '../../keys/gpt-supabase-operator-key.json'));

/* init removed */
});
const db = { collection: () => ({ doc: () => ({ set: async () => {}, get: async () => ({ exists: false, data: () => ({}) }) }) }) };

async function checkLatest() {
  console.log('--- LATEST 10 EMPLOYEES ---');
  const emps = await db.collection('employees').orderBy('createdAt', 'desc').limit(10).get();
  emps.forEach(doc => {
     console.log(doc.id, doc.data().displayName, doc.data().email, doc.data().phone, "approved?", doc.data().approved);
  });

  console.log('\n--- LATEST 10 USERS ---');
  const users = await db.collection('users').orderBy('createdAt', 'desc').limit(10).get();
  users.forEach(doc => {
     console.log(doc.id, doc.data().displayName, doc.data().email, doc.data().phone, "role:", doc.data().role, "status:", doc.data().status);
  });
}
checkLatest().then(() => process.exit(0)).catch(console.error);
