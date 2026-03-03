/* supabase admin removed */
const sa = require('./supabase-service-account.json');
/* init removed */ });
const db = { collection: () => ({ doc: () => ({ set: async () => {}, get: async () => ({ exists: false, data: () => ({}) }) }) }) };

async function check() {
  const snap = await db.collection('conversations').limit(5).get();
  snap.forEach(doc => {
    console.log(doc.id, '->', doc.data().photoUrl, doc.data().photo_url);
  });
  process.exit(0);
}
check();
