const { db } = require('./src/supabase');

async function countConversations() {
    try {
        console.log('Counting conversations...');
        const snapshot = await db.collection('conversations').get();
        console.log(`Total conversations: ${snapshot.size}`);
        
        if (snapshot.size > 0) {
            console.log('Sample conversation:', snapshot.docs[0].id, snapshot.docs[0].data());
        } else {
            console.log('No conversations found.');
        }
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

countConversations();
