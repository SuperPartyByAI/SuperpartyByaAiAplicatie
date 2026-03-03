console.log('STARTING APPROVAL SCRIPT');
try {
  const serviceAccount = require('../serviceAccountKey.json');
  console.log('Project ID:', serviceAccount.project_id);

  const fb = require('./supabase');
  console.log('Supabase Loaded');
  const { db, auth, FieldValue } = fb;
  
  async function run() {
    const uid = 'iXwCfylAITZDJMFooYhPlFoo8cA3'; 
    const email = 'test_security_1771286263447668000@example.com';
    
    console.log('Approving ' + uid);
    
    // 1. Force Write to Database
    await db.collection('employees').doc(uid).set({
        uid: uid,
        email: email,
        displayName: 'Flow Tester Force',
        role: 'employee',
        approved: true,
        approvedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    console.log('Database Updated');

    // 2. Set Custom Claims
    await auth.setCustomUserClaims(uid, { approved: true, role: 'employee' });
    console.log('Claims Updated');

    // 3. Verify Read
    const doc = await db.collection('employees').doc(uid).get();
    if (!doc.exists) {
        console.log('CRITICAL: User doc STILL DOES NOT EXIST after write!');
    } else {
        console.log('Verification Read Success:', JSON.stringify(doc.data(), null, 2));
    }
  }
  
  run().then(() => {
    console.log('FINISHED');
    process.exit(0);
  }).catch(e => {
    console.error('Run Error:', e);
    process.exit(1);
  });
} catch (e) {
  console.error('REQUIRE FAILED:', e);
}
