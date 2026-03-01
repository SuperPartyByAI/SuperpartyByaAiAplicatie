const admin = require('firebase-admin');
const sa = require('./firebase-service-account.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

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
