const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

// Try a few possible paths for the service account key
const possiblePaths = [
    '/Users/universparty/AplicatieSuperParty/Superparty-App/server/superpartybyai-db3d8-firebase-adminsdk-vsws0-3df139a06f.json',
    '/Users/universparty/AplicatieSuperParty/Superparty-App/server/firebase-service-account.json',
    path.join(__dirname, 'superpartybyai-db3d8-firebase-adminsdk-vsws0-d29a584988.json'),
    path.join(__dirname, 'firebase-service-account.json')
];

let serviceAccount;
for (const p of possiblePaths) {
    try {
        if (fs.existsSync(p)) {
            serviceAccount = JSON.parse(fs.readFileSync(p, 'utf8'));
            console.log('Using credentials from:', p);
            break;
        }
    } catch(e) {}
}

if (!serviceAccount) {
    console.error('Could not find a valid service account JSON file.');
    process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function run() {
    const email = 'marius.alin2005@gmail.com';
    console.log(`Checking DB for ${email}...`);
    
    let found = false;
    const empSnap = await db.collection('employees').where('email', '==', email).get();
    empSnap.forEach(doc => {
       console.log('--- EMPLOYEES COLLECTION ---');
       console.log(doc.id, '=>', doc.data());
       found = true;
    });

    const usrSnap = await db.collection('users').where('email', '==', email).get();
    usrSnap.forEach(doc => {
       console.log('--- USERS COLLECTION ---');
       console.log(doc.id, '=>', doc.data());
       found = true;
    });

    if (!found) console.log('User not found in any collection.');
}

run().catch(console.error);
