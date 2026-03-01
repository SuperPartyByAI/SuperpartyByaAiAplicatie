import { initFirebase } from './firebase-sync.js';
import admin from 'firebase-admin';

async function run() {
  try {
    const db = initFirebase();
    const snapshot = await db.collection('employees').get();
    const all = {};
    const requests = [];
    const approved = [];
    
    snapshot.forEach(doc => {
      const d = doc.data();
      const email = d.email || 'NoEmail_' + doc.id;
      
      if (!all[email]) all[email] = [];
      all[email].push({ id: doc.id, email: d.email, approved: d.approved, suspended: d.suspended, rejectedAt: d.rejectedAt });
      
      if (d.approved === true) {
          approved.push(d.email);
      }
      if (d.approved !== true && d.suspended !== true) {
          requests.push(d.email);
      }
    });

    console.log(`\n\n--- STATS ---`);
    console.log(`Total Requests: ${requests.length}`);
    console.log(`Total Approved: ${approved.length}`);
    
    const overlap = requests.filter(email => approved.includes(email));
    console.log(`\n--- OVERLAP (In both Requests & Approved) ---`);
    console.log(overlap);

    console.log(`\n\n--- DUPLICATES BY EMAIL ---`);
    for (const [email, docs] of Object.entries(all)) {
      if (docs.length > 1) {
          console.log(`\nDuplicates for: ${email}`);
          console.log(JSON.stringify(docs, null, 2));
      }
    }
  } catch(e) {
      console.error(e);
  }
  process.exit(0);
}
run();
