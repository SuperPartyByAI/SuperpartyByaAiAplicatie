const admin = require('firebase-admin');
const path = require('path');
const serviceAccount = require(path.resolve(__dirname, '../../keys/gpt-firebase-operator-key.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

async function checkPending() {
  const snapshot = await db.collection('users').where('status', '==', 'pending').get();
  console.log(`Found ${snapshot.size} users with status='pending'`);
  snapshot.forEach(doc => console.log(doc.id, doc.data()));

  const snapshot2 = await db.collection('employee_requests').get();
  console.log(`\nFound ${snapshot2.size} employee_requests`);
  snapshot2.forEach(doc => console.log(doc.id, doc.data()));
  
  const snapshot3 = await db.collection('users').where('role', '==', 'pending').get();
  console.log(`\nFound ${snapshot3.size} users with role='pending'`);
  snapshot3.forEach(doc => console.log(doc.id, doc.data()));
  
  const snapshot4 = await db.collection('users').orderBy('createdAt', 'desc').limit(5).get();
  console.log(`\nRecent 5 users created:`);
  snapshot4.forEach(doc => console.log(doc.id, doc.data().name, doc.data().email, doc.data().role, doc.data().status));
}
checkPending().then(() => process.exit(0)).catch(console.error);
