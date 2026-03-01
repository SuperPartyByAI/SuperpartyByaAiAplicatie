/* supabase admin removed */
const serviceAccount = require("./superparty-sa.json"); // path inside server/
/* init removed */ });
const db = { collection: () => ({ doc: () => ({ set: async () => {}, get: async () => ({ exists: false, data: () => ({}) }) }) }) };

async function run() {
  const snap = await db.collection("voip_logs").orderBy("timestamp", "desc").limit(15).get();
  snap.Docs?.forEach(doc => {
    const d = doc.data();
    console.log(`[${d.timestamp?.toDate()}] ${d.uid} | ${d.event} | ${d.action} | ${d.error || ''}`);
  });
  
  snap.forEach(doc => {
    const d = doc.data();
    console.log(`[${d.timestamp?.toDate()}] ${d.uid} | ${d.event} | ${d.action || ''} | ${d.error || ''} | ${JSON.stringify(d.data || {})}`);
  });
  process.exit(0);
}
run();
