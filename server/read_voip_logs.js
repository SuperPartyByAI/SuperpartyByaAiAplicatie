import { initFirebase, db } from "./firebase-sync.js";

async function run() {
  await initFirebase();
  const snap = await db.collection("voip_logs").orderBy("timestamp", "desc").limit(20).get();
  snap.forEach(doc => {
    const d = doc.data();
    console.log(`[${d.timestamp?.toDate?.()?.toISOString()}] [${d.uid}] Event: ${d.event}, Details: ${JSON.stringify(d.details)}`);
  });
  process.exit(0);
}
run();
