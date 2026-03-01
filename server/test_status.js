import { createRequire } from "module";
const require = createRequire(import.meta.url);
const admin = require("firebase-admin");
const serviceAccount = require("./firebase-service-account.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function checkStatus() {
  try {
     const snap = await db.collection("wa_accounts").get();
     let found = false;
     snap.forEach(doc => {
         const data = doc.data();
         if(data.label && data.label.toLowerCase().includes('superparty')) {
             console.log(`\nAccount: ${data.label} (ID: ${doc.id})`);
             console.log(`State: ${data.state} | Phone: ${data.phoneNumber}`);
             console.log(`Ping: ${data.pingMs}ms | IN: ${data.messagesIn} | OUT: ${data.messagesOut}`);
             found = true;
         }
     });
     if(!found) {
         console.log("\nSearching all for 07... (Superparty phone usually)");
          snap.forEach(doc => {
              const data = doc.data();
              console.log(`- ${data.label}: ${data.state} (${data.phoneNumber})`);
         });
     }
  } catch(e) {
     console.error("Query failed:", e);
  }
}

checkStatus().then(() => process.exit(0));
