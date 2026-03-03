const { db } = require('./src/supabase');

async function checkStatus() {
    try {
        const docId = 'Ztj2SRhRWAflLQh7iVi5';
        const doc = await db.collection('wa_accounts').doc(docId).get();
        console.log('Account Status:', doc.exists ? doc.data().status : 'NOT FOUND');
        
        const convs = await db.collection('conversations').count().get();
        console.log('Total Conversations:', convs.data().count);
        
         if (doc.exists && doc.data().status === 'connected') {
             console.log('✅ Connection verified.');
         }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

checkStatus();
