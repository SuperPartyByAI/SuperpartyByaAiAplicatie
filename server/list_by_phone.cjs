const admin = require('firebase-admin');
const path = require('path');
const serviceAccount = require(path.resolve(__dirname, '../../keys/gpt-firebase-operator-key.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

async function checkPhone() {
  const nums = await db.collection('users').get();
  console.log('searching all users for phone containing 0737571397...');
  nums.forEach(doc => {
     if(doc.data().phone && doc.data().phone.includes('0737571397') || doc.data().phone && doc.data().phone.includes('737571397')) {
         console.log('USER', doc.id, doc.data().email, doc.data().phone, doc.data().role, doc.data().status, doc.data().approved);
     }
  });

  const emps = await db.collection('employees').get();
  emps.forEach(doc => {
     if(doc.data().phone && doc.data().phone.includes('0737571397') || doc.data().phone && doc.data().phone.includes('737571397')) {
         console.log('EMPLOYEE', doc.id, doc.data().email, doc.data().phone, doc.data().approved);
     }
  });
}
checkPhone().then(() => process.exit(0)).catch(console.error);
