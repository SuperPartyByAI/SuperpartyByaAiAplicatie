const { db } = require('./src/firebase');

async function checkAccount() {
    try {
        const docId = 'Ztj2SRhRWAflLQh7iVi5'; // From logs
        console.log(`Checking account ${docId}...`);
        const doc = await db.collection('wa_accounts').doc(docId).get();
        
        if (doc.exists) {
            console.log('Account Data:', JSON.stringify(doc.data(), null, 2));
        } else {
            console.log('Account not found (maybe ID mismatch?)');
            // List all to be sure
            const snap = await db.collection('wa_accounts').get();
            snap.forEach(d => console.log(d.id, d.data().label));
        }
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

checkAccount();
