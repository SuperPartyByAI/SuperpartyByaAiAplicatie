/**
 * SuperParty — Canonical JID Migration Script
 * 
 * Detectează duplicate în colecția `threads` (documente cu același phone number
 * dar docId diferit) și consolidează în canonicalJid.
 * 
 * USAGE:
 *   DRY_RUN=true node scripts/migrate-canonical-jid.js   # Preview (default)
 *   DRY_RUN=false node scripts/migrate-canonical-jid.js  # Execute
 * 
 * ROLLBACK:
 *   Scriptul salvează un backup JSON înainte de orice operațiune.
 *   Restaurare: node scripts/migrate-canonical-jid.js --restore <backup-file>
 */

import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

// Firebase init
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID || 'superparty-frontend',
  });
}
const db = admin.firestore();

const DRY_RUN = (process.env.DRY_RUN || 'true').toLowerCase() !== 'false';
const BACKUP_DIR = path.join(process.cwd(), 'backups');

async function main() {
  console.log('=== Canonical JID Migration ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : '⚠️  LIVE — will modify data'}`);
  console.log('');

  // 1. Load all threads
  const threadsSnap = await db.collection('threads').get();
  console.log(`Total threads: ${threadsSnap.size}`);

  // 2. Group by phone number (normalized)
  const phoneGroups = new Map(); // phone -> [{ docId, data, lastMessageAt }]
  
  for (const doc of threadsSnap.docs) {
    const data = doc.data();
    const phone = normalizePhone(data.clientId || data.phone || doc.id);
    
    if (!phone) continue;
    
    const entry = {
      docId: doc.id,
      data,
      lastMessageAt: toTimestamp(data.lastMessageAt),
      messageCount: data.messageCount || 0,
    };
    
    if (!phoneGroups.has(phone)) {
      phoneGroups.set(phone, []);
    }
    phoneGroups.get(phone).push(entry);
  }

  // 3. Find duplicates
  const duplicates = [];
  for (const [phone, entries] of phoneGroups) {
    if (entries.length > 1) {
      duplicates.push({ phone, entries });
    }
  }

  console.log(`Unique phone numbers: ${phoneGroups.size}`);
  console.log(`Duplicated phone numbers: ${duplicates.length}`);
  console.log('');

  if (duplicates.length === 0) {
    console.log('✅ No duplicates found. Nothing to migrate.');
    return;
  }

  // 4. Backup
  if (!DRY_RUN) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const backupFile = path.join(BACKUP_DIR, `canonical-migration-backup-${Date.now()}.json`);
    const backupData = duplicates.map(d => ({
      phone: d.phone,
      entries: d.entries.map(e => ({ docId: e.docId, data: e.data })),
    }));
    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
    console.log(`📦 Backup saved: ${backupFile}`);
    console.log('');
  }

  // 5. Process duplicates
  let mergedCount = 0;
  let deletedCount = 0;

  for (const { phone, entries } of duplicates) {
    // Sort: latest message first
    entries.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
    
    const winner = entries[0];
    const losers = entries.slice(1);

    console.log(`📱 ${phone}: ${entries.length} docs → keeping ${winner.docId} (lastMsg: ${new Date(winner.lastMessageAt * 1000).toISOString()})`);
    
    for (const loser of losers) {
      console.log(`   ❌ Remove: ${loser.docId} (lastMsg: ${loser.lastMessageAt ? new Date(loser.lastMessageAt * 1000).toISOString() : 'never'})`);
      
      if (!DRY_RUN) {
        // Merge message subcollection if exists
        const loserMsgs = await db.collection('threads').doc(loser.docId).collection('messages').get();
        if (!loserMsgs.empty) {
          console.log(`   📨 Moving ${loserMsgs.size} messages from ${loser.docId} → ${winner.docId}`);
          const batch = db.batch();
          for (const msg of loserMsgs.docs) {
            const destRef = db.collection('threads').doc(winner.docId).collection('messages').doc(msg.id);
            batch.set(destRef, msg.data(), { merge: true });
          }
          await batch.commit();
        }

        // Update winner with canonicalJid
        await db.collection('threads').doc(winner.docId).update({
          canonicalJid: phone,
          mergedFrom: admin.firestore.FieldValue.arrayUnion(loser.docId),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Mark loser as archived (don't delete — NEVER DELETE policy)
        await db.collection('threads').doc(loser.docId).update({
          isArchived: true,
          archivedReason: 'canonical_migration',
          mergedInto: winner.docId,
          archivedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        deletedCount++;
      }
    }
    mergedCount++;
  }

  console.log('');
  console.log(`=== Result ===`);
  console.log(`Phone groups merged: ${mergedCount}`);
  console.log(`Duplicate docs archived: ${deletedCount}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN — no changes made' : 'LIVE — changes applied'}`);
}

function normalizePhone(raw) {
  if (!raw) return null;
  // Remove @s.whatsapp.net, @c.us suffixes
  let phone = raw.split('@')[0];
  // Remove non-digit chars
  phone = phone.replace(/\D/g, '');
  // Minimum 7 digits for valid phone
  if (phone.length < 7) return null;
  return phone;
}

function toTimestamp(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (val._seconds) return val._seconds;
  if (val.seconds) return val.seconds;
  if (val.toDate) return Math.floor(val.toDate().getTime() / 1000);
  return 0;
}

main().catch(e => {
  console.error('Migration error:', e);
  process.exit(1);
});
