const admin = require('firebase-admin');
const sa = require('./firebase-service-account.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function check() {
  const snap = await db.collection('conversations').limit(5).get();
  snap.forEach(doc => {
    console.log(doc.id, '->', doc.data().photoUrl, doc.data().photo_url);
  });
  process.exit(0);
}
check();
