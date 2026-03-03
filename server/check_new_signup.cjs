/* supabase admin removed */
const serviceAccount = require('../../keys/gpt-supabase-operator-key.json');
/* init removed */
});
const db = { collection: () => ({ doc: () => ({ set: async () => {}, get: async () => ({ exists: false, data: () => ({}) }) }) }) };

async function run() {
  console.log('--- RECENT EMPLOYEES ---');
  try {
    const emps = await db.collection('employees').orderBy('createdAt', 'desc').limit(5).get();
    emps.forEach(d => console.log(d.id, d.data().email, d.data().status, d.data().approved));
  } catch(e) { console.error("employees error", e.message); }

  console.log('\n--- RECENT REQUESTS ---');
  try {
    const reqs = await db.collection('employee_requests').orderBy('createdAt', 'desc').limit(5).get();
    reqs.forEach(d => console.log(d.id, d.data().email, d.data().status));
  } catch(e) { console.error("requests error", e.message); }
  
  process.exit(0);
}
run();
