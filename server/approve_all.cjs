const admin = require('firebase-admin');
const path = require('path');
const serviceAccount = require(path.resolve(__dirname, '../../keys/gpt-firebase-operator-key.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

async function approveAllPending() {
  const emps = await db.collection('employees').where('approved', '==', false).get();
  console.log(`Found ${emps.size} pending employees to approve.`);
  
  for (const doc of emps.docs) {
    const data = doc.data();
    console.log(`Approving: ${data.email || data.displayName}`);
    
    // 1. Approve in Firestore
    await doc.ref.update({
       approved: true,
       suspended: false,
       role: 'employee',
       approvedAt: new Date()
    });
    
    // 2. Set Custom Claims using whatever UID we have
    let authUid = data.uid;
    try {
        if (!authUid && data.email) {
            const userRecord = await admin.auth().getUserByEmail(data.email);
            authUid = userRecord.uid;
        }
        if (authUid) {
            await admin.auth().setCustomUserClaims(authUid, { approved: true, role: 'employee' });
            
            // 3. Create/update profile in 'users'
            await db.collection('users').doc(authUid).set({
                email: data.email || '',
                displayName: data.displayName || '',
                phone: data.phone || '',
                role: 'employee',
                approved: true,
                createdAt: data.createdAt || new Date(),
                uid: authUid
            }, { merge: true });
            
            console.log(`Successfully approved and set claims for ${data.email}`);
        } else {
            console.log(`Could not resolve Auth UID for ${data.email}`);
        }
    } catch (e) {
        console.error(`Failed to auth approve ${data.email}: ${e.message}`);
    }
  }
}

approveAllPending().then(() => process.exit(0)).catch(console.error);
