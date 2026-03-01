const admin = require('firebase-admin');
const serviceAccount = require('../../keys/gpt-firebase-operator-key.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

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
