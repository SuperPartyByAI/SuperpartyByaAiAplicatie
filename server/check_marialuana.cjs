const admin = require('firebase-admin');
const path = require('path');
const serviceAccount = require(path.resolve(__dirname, '../../keys/gpt-firebase-operator-key.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

async function check() {
  const emps = await db.collection('employees').where('email', '==', 'marialuana2208@gmail.com').get();
  console.log(`Found ${emps.size} employee docs directly`);
  emps.forEach(doc => console.log(doc.id, doc.data()));

  const phoneQuery = await db.collection('employees').where('phone', '==', '0737571397').get();
  console.log(`Found ${phoneQuery.size} employee docs by phone `);
  phoneQuery.forEach(doc => console.log(doc.id, doc.data()));

}
check().then(() => process.exit(0)).catch(console.error);
