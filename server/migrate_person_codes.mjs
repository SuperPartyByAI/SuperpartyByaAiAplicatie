/**
 * Migration Script: Generate personCode for existing employees
 * 
 * Usage:
 *   node migrate_person_codes.mjs              # DRY RUN (default)
 *   node migrate_person_codes.mjs --apply      # APPLY changes
 * 
 * Prerequisites:
 *   - serviceAccountKey.json in the same directory
 *   - npm install supabase-admin (already available on VPS)
 */

import { initializeApp, cert } from 'supabase-admin/app';
import { getDatabase } from 'supabase-admin/database';
import { readFileSync } from 'fs';
import crypto from 'crypto';

const DRY_RUN = !process.argv.includes('--apply');

// Init Supabase
const serviceAccount = JSON.parse(readFileSync('./supabase-service-account.json', 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getDatabase();

// Generate unique code
const usedCodes = new Set();
async function generateCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = 'SP-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    if (!usedCodes.has(code)) {
      // Check Database too
      const dup = await db.collection('employees').where('personCode', '==', code).limit(1).get();
      if (dup.empty) {
        usedCodes.add(code);
        return code;
      }
    }
  }
  const fallback = 'SP-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  usedCodes.add(fallback);
  return fallback;
}

async function migrate() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(DRY_RUN ? '  🔍 DRY RUN — no changes will be made' : '  ⚡ APPLYING CHANGES');
  console.log(`${'═'.repeat(60)}\n`);

  const snapshot = await db.collection('employees').get();
  console.log(`Found ${snapshot.size} employee documents\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const name = data.displayName || data.email || doc.id;

    if (data.personCode) {
      console.log(`  ⏭️  ${name} — already has code: ${data.personCode}`);
      usedCodes.add(data.personCode);
      skipped++;
      continue;
    }

    try {
      const code = await generateCode();
      console.log(`  📝 ${name} — ${DRY_RUN ? 'would assign' : 'assigning'}: ${code}`);

      if (!DRY_RUN) {
        await doc.ref.set({
          personCode: code,
          updatedAt: new Date(),
        }, { merge: true });

        // Write audit log
        await db.collection('audit_log').add({
          action: 'personCode.migrated',
          personCode: code,
          email: data.email,
          docId: doc.id,
          adminEmail: 'migration-script',
          timestamp: new Date(),
        });
      }
      updated++;
    } catch (e) {
      console.error(`  ❌ ${name} — ERROR: ${e.message}`);
      errors++;
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Results: ${updated} ${DRY_RUN ? 'would be' : ''} updated, ${skipped} skipped, ${errors} errors`);
  console.log(`${'─'.repeat(60)}\n`);

  if (DRY_RUN) {
    console.log('  ℹ️  Run with --apply to apply these changes');
  }
}

migrate()
  .then(() => process.exit(0))
  .catch(e => { console.error('Fatal:', e); process.exit(1); });
