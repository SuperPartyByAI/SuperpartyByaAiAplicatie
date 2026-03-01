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
const { FieldValue } = require("firebase-admin/firestore");

async function testInc() {
  const docId = "7MXiCIPXm1ZGeXxk5X58"; // known superparty test id
  console.log(`Testing increment on ${docId}...`);
  try {
     const inc = FieldValue.increment(1);
     await db.collection("wa_accounts").doc(docId).set({ messagesOut: inc }, { merge: true });
     console.log("Increment successful.");
     
     const snap = await db.collection("wa_accounts").doc(docId).get();
     console.log("Current OUT value:", snap.data().messagesOut);
  } catch(e) {
     console.error("Increment failed:", e);
  }
}

testInc().then(() => process.exit(0));
