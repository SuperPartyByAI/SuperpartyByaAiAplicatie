/**
 * MIGRATE FIREBASE → SUPABASE
 * Superparty App - Data Migration Script
 * 
 * Usage: node migrate_firebase_to_supabase.js
 */

const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

// ── CONFIG ────────────────────────────────────────────────────
const SUPABASE_URL = 'https://ilkphpidhuytucxlglqi.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdWJhc2UiLCJyZWZlcmVuY2UiOiJpbGtwaHBpZGh1eXR1Y3hsZ2xxaSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUiLCJpYXQiOjE3NzM0NTQ1MTYsImV4cCI6MjA4OTAzMDUxNn0.zsCNAng5tlP_k9_pt5hSvtOkA2B_H6T63ie5XhjUSIU';

const FIREBASE_SA_PATH = '/root/whatsapp-integration-v6/firebase-service-account.json';

// ── INIT ──────────────────────────────────────────────────────
const sa = require(FIREBASE_SA_PATH);
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── HELPERS ───────────────────────────────────────────────────
function toTimestamp(val) {
  if (!val) return null;
  if (val && val._seconds) return val._seconds;
  if (typeof val === 'number') return val;
  return null;
}

function clean(obj) {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) result[k] = v;
  }
  return result;
}

let stats = { conversations: 0, messages: 0, wa_accounts: 0, employees: 0, app_inbox: 0, errors: 0 };

// ── MIGRATE CONVERSATIONS + MESSAGES ─────────────────────────
async function migrateConversations() {
  console.log('\n📦 Migrating conversations...');
  const snap = await db.collection('conversations').get();
  console.log(`   Found ${snap.size} documents`);

  const SYSTEM_NAMES = new Set(['System']);
  let skipped = 0;

  for (const doc of snap.docs) {
    const d = doc.data();
    const name = d.name || d.clientId || '';
    
    // Skip System/junk entries
    if (SYSTEM_NAMES.has(name)) { skipped++; continue; }

    const row = clean({
      id: doc.id,
      jid: d.jid || null,
      name: name || null,
      phone: d.phone || d.jid?.split('@')[0] || null,
      account_id: d.accountId || null,
      account_label: d.accountLabel || null,
      client_id: d.clientId || null,
      last_message_at: toTimestamp(d.lastMessageAt || d.updatedAt),
      last_message_preview: d.lastMessagePreview || null,
      photo_url: d.photoUrl || null,
      assigned_employee_id: d.assignedEmployeeId || null,
      assigned_employee_name: d.assignedEmployeeName || null,
      unread_count: d.unreadCount || 0,
      is_group: d.isGroup || false,
    });

    const { error } = await supabase.from('conversations').upsert(row, { onConflict: 'id' });
    if (error) {
      console.error(`   ❌ Conv ${doc.id}: ${error.message}`);
      stats.errors++;
      continue;
    }
    stats.conversations++;

    // Migrate messages subcollection
    const msgsSnap = await doc.ref.collection('messages').limit(500).get();
    if (!msgsSnap.empty) {
      const msgRows = msgsSnap.docs.map(m => {
        const md = m.data();
        return clean({
          id: m.id,
          conversation_id: doc.id,
          text: md.text || '',
          type: md.type || 'chat',
          from_me: md.fromMe === true,
          push_name: md.pushName || null,
          timestamp: toTimestamp(md.timestamp),
          media_url: md.mediaUrl || null,
          mimetype: md.mimetype || null,
        });
      });

      const { error: msgErr } = await supabase.from('messages').upsert(msgRows, { onConflict: 'id' });
      if (msgErr) {
        console.error(`   ❌ Messages for ${doc.id}: ${msgErr.message}`);
        stats.errors++;
      } else {
        stats.messages += msgRows.length;
      }
    }

    if (stats.conversations % 50 === 0) {
      process.stdout.write(`   ✅ ${stats.conversations} conversations, ${stats.messages} messages...\r`);
    }
  }
  console.log(`\n   ✅ Done: ${stats.conversations} conversations (skipped ${skipped} System), ${stats.messages} messages`);
}

// ── MIGRATE WA_ACCOUNTS ───────────────────────────────────────
async function migrateWaAccounts() {
  console.log('\n📦 Migrating wa_accounts...');
  const snap = await db.collection('wa_accounts').get();
  
  for (const doc of snap.docs) {
    const d = doc.data();
    const row = clean({
      id: doc.id,
      label: d.label || doc.id,
      phone_number: d.phoneNumber || null,
      state: d.state || d.status || 'disconnected',
      ping_ms: d.pingMs || 0,
      messages_in: d.messagesIn || 0,
      messages_out: d.messagesOut || 0,
      recent_logs: d.recentLogs ? JSON.stringify(d.recentLogs) : '[]',
    });

    const { error } = await supabase.from('wa_accounts').upsert(row, { onConflict: 'id' });
    if (error) { console.error(`   ❌ ${doc.id}: ${error.message}`); stats.errors++; continue; }
    stats.wa_accounts++;
  }
  console.log(`   ✅ ${stats.wa_accounts} wa_accounts`);
}

// ── MIGRATE EMPLOYEES ─────────────────────────────────────────
async function migrateEmployees() {
  console.log('\n📦 Migrating employees...');
  const snap = await db.collection('employees').get();
  
  for (const doc of snap.docs) {
    const d = doc.data();
    const row = clean({
      id: doc.id,
      email: d.email || null,
      name: d.name || d.displayName || null,
      role: d.role || 'staff',
      phone: d.phone || null,
      status: d.status || 'active',
    });

    const { error } = await supabase.from('employees').upsert(row, { onConflict: 'id' });
    if (error) { console.error(`   ❌ ${doc.id}: ${error.message}`); stats.errors++; continue; }
    stats.employees++;
  }
  console.log(`   ✅ ${stats.employees} employees`);
}

// ── MIGRATE APP_INBOX ─────────────────────────────────────────
async function migrateAppInbox() {
  console.log('\n📦 Migrating app_inbox...');
  const snap = await db.collection('app_inbox').get();
  
  for (const doc of snap.docs) {
    const d = doc.data();
    const row = clean({
      title: d.title || 'Notificare',
      body: d.body || d.message || '',
      type: d.type || 'announcement',
      source: d.source || 'system',
      read_by: d.readBy || [],
    });

    const { error } = await supabase.from('app_inbox').insert(row);
    if (error && !error.message.includes('duplicate')) {
      console.error(`   ❌ ${doc.id}: ${error.message}`);
      stats.errors++;
      continue;
    }
    stats.app_inbox++;
  }
  console.log(`   ✅ ${stats.app_inbox} app_inbox entries`);
}

// ── MAIN ──────────────────────────────────────────────────────
async function main() {
  console.log('🚀 SUPERPARTY: Firebase → Supabase Migration');
  console.log('================================================');
  console.log(`Supabase: ${SUPABASE_URL}`);
  console.log('');

  // Test Supabase connection
  const { error: pingErr } = await supabase.from('conversations').select('id').limit(1);
  if (pingErr) {
    console.error('❌ Cannot connect to Supabase:', pingErr.message);
    console.error('   → Make sure you ran supabase_schema.sql first!');
    process.exit(1);
  }
  console.log('✅ Supabase connection OK\n');

  await migrateConversations();
  await migrateWaAccounts();
  await migrateEmployees();
  await migrateAppInbox();

  console.log('\n================================================');
  console.log('✅ MIGRATION COMPLETE');
  console.log(`   conversations: ${stats.conversations}`);
  console.log(`   messages:      ${stats.messages}`);
  console.log(`   wa_accounts:   ${stats.wa_accounts}`);
  console.log(`   employees:     ${stats.employees}`);
  console.log(`   app_inbox:     ${stats.app_inbox}`);
  console.log(`   errors:        ${stats.errors}`);
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
