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

const MINUTES = 10;
const TOP_CLIENTS = 5;
const TOP_MSGS = 3;

function toDateSafe(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isRecent(d, minutes = MINUTES) {
  if (!d) return false;
  return d.getTime() >= Date.now() - minutes * 60 * 1000;
}

async function main() {
  console.log(`\n=== REALTIME AUDIT (last ${MINUTES} minutes) ===\n`);

  const accountsSnap = await db.collection("whatsapp_accounts").get();
  console.log(`Accounts: ${accountsSnap.size}\n`);

  for (const accDoc of accountsSnap.docs) {
    const acc = accDoc.data();
    const accId = accDoc.id;

    const lastRTIngest = toDateSafe(
      acc.ultimaIngestieInTimpRealLa || acc.lastRealtimeIngestionAt
    );
    const lastRTMsg = toDateSafe(
      acc.ultimulMesajInTimpRealLa || acc.lastRealtimeMessageAt
    );

    console.log(`\n📱 Account: ${accId}`);
    console.log(
      `   name: ${acc.nume || acc.name || "N/A"} | phone: ${
        acc.telefonE164 || acc.phoneE164 || "N/A"
      } | status: ${acc.stare || acc.status || "N/A"}`
    );
    console.log(
      `   lastRealtimeIngestionAt: ${lastRTIngest} ${
        isRecent(lastRTIngest) ? "🔥" : ""
      }`
    );
    console.log(
      `   lastRealtimeMessageAt:  ${lastRTMsg} ${
        isRecent(lastRTMsg) ? "🔥" : ""
      }`
    );

    const clientsQ = db
      .collection("whatsapp_accounts")
      .doc(accId)
      .collection("clients")
      .orderBy("lastMessageAt", "desc")
      .limit(TOP_CLIENTS);

    let clientsSnap;
    try {
      clientsSnap = await clientsQ.get();
    } catch (e) {
      console.log(`   ❌ clients query failed: ${e.message}`);
      continue;
    }

    console.log(`   Top ${TOP_CLIENTS} clients by lastMessageAt:`);

    for (const cDoc of clientsSnap.docs) {
      const c = cDoc.data();
      const cId = cDoc.id;
      const lma = toDateSafe(c.lastMessageAt);
      const preview = (c.lastMessageText || c.lastMessagePreview || "")
        .toString()
        .slice(0, 60);

      console.log(`   - ${isRecent(lma) ? "🔥" : "  "} clientId=${cId}`);
      console.log(
        `       lastMessageAt=${lma} | unread=${c.unreadCount ?? "?"} | dir=${
          c.lastMessageDirection ?? "?"
        }`
      );
      console.log(`       preview="${preview}"`);

      let msgsSnap;
      try {
        msgsSnap = await db
          .collection("whatsapp_accounts")
          .doc(accId)
          .collection("clients")
          .doc(cId)
          .collection("messages")
          .orderBy("createdAt", "desc")
          .limit(TOP_MSGS)
          .get();
      } catch (e) {
        console.log(`       ❌ messages query failed: ${e.message}`);
        continue;
      }

      if (msgsSnap.empty) {
        console.log("       ⚠️ no messages documents");
      } else {
        for (const mDoc of msgsSnap.docs) {
          const m = mDoc.data();
          const cd = toDateSafe(m.createdAt || m.timestamp || m.sentAt);
          const body = (m.body || m.text || m.message || "")
            .toString()
            .slice(0, 60);
          console.log(
            `       msg: ${isRecent(cd) ? "🔥" : "  "} createdAt=${cd} fromMe=${
              m.fromMe ?? "?"
            } body="${body}"`
          );
        }
      }
    }
  }

  console.log("\n=== DONE ===\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
