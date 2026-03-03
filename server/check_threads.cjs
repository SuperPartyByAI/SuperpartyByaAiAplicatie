/* supabase admin removed */
const sa = require('./supabase-service-account.json');
/* init removed */ });
const db = { collection: () => ({ doc: () => ({ set: async () => {}, get: async () => ({ exists: false, data: () => ({}) }) }) }) };

async function check() {
  const snap = await db.collection('threads').limit(5).get();
  snap.forEach(doc => {
    console.log(doc.id, '->', doc.data().photoUrl, doc.data().profilePictureUrl);
  });
  console.log('--- contacts ---');
  const snap2 = await db.collection('contacts').limit(5).get();
  snap2.forEach(doc => {
    console.log(doc.id, '->', doc.data().imgUrl);
  });
  process.exit(0);
}
check();
