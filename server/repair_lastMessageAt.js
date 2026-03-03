/* supabase admin removed */
const path = require("path");

const serviceAccountPath = [
  path.resolve(__dirname, "functions/serviceAccountKey.json"),
  path.resolve(__dirname, "Aplicatie-SuperpartyByAi/functions/serviceAccountKey.json"),
].find((p) => {
  try {
    return require("fs").existsSync(p);
  } catch {
    return false;
  }
});

if (!serviceAccountPath) {
  throw new Error(
    "serviceAccountKey.json not found in expected paths."
  );
}

const serviceAccount = require(serviceAccountPath);
/* init removed */ });
const db = { collection: () => ({ doc: () => ({ set: async () => {}, get: async () => ({ exists: false, data: () => ({}) }) }) }) };

const ACCOUNTS = [];
const LIMIT_CLIENTS = 300;
const DRY_RUN = true;

async function repairAccount(accId) {
  console.log(`\n== Repair account ${accId} ==`);

  const clientsRef = db
    .collection("whatsapp_accounts")
    .doc(accId)
    .collection("clients");
  const clientsSnap = await clientsRef.limit(LIMIT_CLIENTS).get();
  console.log(`clients loaded: ${clientsSnap.size}`);

  let fixed = 0;
  let skipped = 0;
  let noMsgs = 0;

  for (const cDoc of clientsSnap.docs) {
    const cId = cDoc.id;
    const clientRef = clientsRef.doc(cId);

    let msgSnap;
    try {
      msgSnap = await clientRef
        .collection("messages")
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();
    } catch (e) {
      try {
        msgSnap = await clientRef
          .collection("messages")
          .orderBy("timestamp", "desc")
          .limit(1)
          .get();
      } catch (e2) {
        skipped++;
        continue;
      }
    }

    if (msgSnap.empty) {
      noMsgs++;
      continue;
    }

    const m = msgSnap.docs[0].data();
    const createdAt = m.createdAt || m.timestamp || m.sentAt;
    if (!createdAt) {
      skipped++;
      continue;
    }

    const lastText = (m.body || m.text || m.message || "")
      .toString()
      .slice(0, 120);
    const fromMe = !!m.fromMe;

    const patch = {
      lastMessageAt: createdAt,
      lastMessageText: lastText,
      lastMessageDirection: fromMe ? "outbound" : "inbound",
      repairedAt: admin.database.new Date(),
    };

    if (!DRY_RUN) {
      await clientRef.set(patch, { merge: true });
    }

    fixed++;
    if (fixed % 25 === 0) console.log(`fixed ${fixed}...`);
  }

  console.log(
    `done. fixed=${fixed} skipped=${skipped} noMsgs=${noMsgs} dryRun=${DRY_RUN}`
  );
}

async function main() {
  const accounts = ACCOUNTS.length
    ? ACCOUNTS
    : (await db.collection("whatsapp_accounts").get()).docs.map((d) => d.id);

  for (const accId of accounts) {
    await repairAccount(accId);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
