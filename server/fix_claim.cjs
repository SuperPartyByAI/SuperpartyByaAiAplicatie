const admin = require('firebase-admin');
const path = require('path');
const serviceAccount = require(path.resolve(__dirname, '../../keys/gpt-firebase-operator-key.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

async function fixClaim() {
  const uid = 'rNAjb2MWeUV100hfJFQRaiwAf4q2'; // Maria Covaci
  const user = await admin.auth().getUser(uid);
  console.log('Current claims:', user.customClaims);
  
  await admin.auth().setCustomUserClaims(uid, { approved: true, role: 'employee' });
  console.log('Set claims to { approved: true, role: "employee" }');
  
  // also set the phone number to 0737571397 if user asked us to try that:
  // "nunarul de telefon este 0737571397 mai inceraca sa faci singur inca odata"
  await db.collection('employees').where('email', '==', 'marialuana2208@gmail.com').get().then(snap => {
      snap.forEach(doc => {
          doc.ref.update({ phone: '0737571397' });
          console.log('Updated phone number for Maria Luana to 0737571397');
      });
  });
}
fixClaim().then(() => process.exit(0)).catch(console.error);
