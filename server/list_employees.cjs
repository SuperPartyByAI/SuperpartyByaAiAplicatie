const admin = require('firebase-admin');
const path = require('path');
const serviceAccount = require(path.resolve(__dirname, '../../keys/gpt-firebase-operator-key.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

async function checkPending() {
  const snapshot = await db.collection('employees').orderBy('createdAt', 'desc').limit(5).get();
  console.log(`Recent 5 employees created:`);
  snapshot.forEach(doc => console.log(doc.id, doc.data().displayName, doc.data().email, "approved:", doc.data().approved, "suspended:", doc.data().suspended));
}
checkPending().then(() => process.exit(0)).catch(console.error);
