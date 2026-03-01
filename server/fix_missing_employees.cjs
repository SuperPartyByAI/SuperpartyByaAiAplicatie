const admin = require('firebase-admin');
const path = require('path');
const serviceAccount = require(path.resolve(__dirname, '../../keys/gpt-firebase-operator-key.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

async function fixEmployees() {
  const users = await db.collection('users').get();
  const emps = await db.collection('employees').get();
  
  const empEmails = new Set();
  emps.forEach(doc => empEmails.add(doc.data().email));

  const missing = [];
  users.forEach(doc => {
     const data = doc.data();
     // If they are a user but not in employees
     if(data.email && !empEmails.has(data.email) && !data.email.startsWith('test_')) {
        missing.push({ id: doc.id, email: data.email, displayName: data.displayName || 'Google User', phone: data.phone || '000000000' });
     }
  });

  console.log(`Found ${missing.length} users missing from employees collection:`);
  console.log(missing);

  // Auto-inject them so they appear in admin requests
  for (const m of missing) {
      await db.collection('employees').add({
         email: m.email,
         displayName: m.displayName,
         phone: m.phone,
         role: 'employee',
         approved: false,
         createdAt: new Date(),
         uid: m.id
      });
      console.log(`Injected ${m.email} into employees collection.`);
  }
}
fixEmployees().then(() => process.exit(0)).catch(console.error);
