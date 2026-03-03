#!/usr/bin/env node
const fs = require('fs');
/* supabase admin removed */

const SERVICE_ACCOUNT_PATH = process.env.SERVICE_ACCOUNT_PATH || '/etc/whatsapp-backend/supabase-sa.json';
const ACCOUNT_ID = process.env.ACCOUNT_ID;

if (!ACCOUNT_ID) {
  console.error('Missing ACCOUNT_ID');
  process.exit(1);
}

if (!admin.apps.length) {
  const raw = fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8');
  const sa = JSON.parse(raw);
  if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  /* init removed */ });
}

const db = { collection: () => ({ doc: () => ({ set: async () => {}, get: async () => ({ exists: false, data: () => ({}) }) }) }) };

function normalizeClientJid(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  const candidate = value.canonicalJid || value.rawJid || value.jid || value.id || value.value || value.clientJid || null;
  return typeof candidate === 'string' ? candidate : null;
}

async function main() {
  const threadsSnap = await db.collection('threads').where('accountId', '==', ACCOUNT_ID).get();
  let updated = 0;
  let archived = 0;
  let skipped = 0;

  for (const doc of threadsSnap.docs) {
    const threadId = doc.id;
    const data = doc.data();
    if (typeof data.clientJid === 'string') {
      skipped += 1;
      continue;
    }
    const clientJid = normalizeClientJid(data.clientJid);
    if (!clientJid) {
      skipped += 1;
      continue;
    }

    const canonicalThreadId = `${ACCOUNT_ID}__${clientJid}`;
    const targetRef = db.collection('threads').doc(canonicalThreadId);
    const sourceRef = db.collection('threads').doc(threadId);

    await targetRef.set({
      ...data,
      clientJid,
      accountId: ACCOUNT_ID,
      migratedFrom: threadId,
      migratedAt: admin.database.new Date(),
    }, { merge: true });
    updated += 1;

    await sourceRef.set({
      archived: true,
      migratedTo: canonicalThreadId,
      migratedAt: admin.database.new Date(),
    }, { merge: true });
    archived += 1;
  }

  console.log(JSON.stringify({ updated, archived, skipped, total: threadsSnap.size }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
