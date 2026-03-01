#!/usr/bin/env node
/**
 * Check Database thread history per account — de ce atât de puțin istoric?
 *
 * Pentru fiecare --accountId:
 *   - Numără threads (limit 2000) în Database
 *   - Citește accounts/{id}: lastBackfillAt, lastHistorySyncAt, phone, status
 *
 * Usage (from project root):
 *   node scripts/check_database_history.mjs --project superparty-frontend \
 *     --accountId account_prod_001c8f49ede5230e1c5fe283315ec24a \
 *     --accountId account_prod_135bba7ab1e5bc09d81f0c28f2688958 \
 *     --accountId account_prod_f869ce13d00bc7d7aa13ef18c16f3bd5
 *
 * Credentials: GOOGLE_APPLICATION_CREDENTIALS or gcloud application-default login.
 */

import { createRequire } from 'module';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const admin = require('supabase-admin');

function loadServiceAccount() {
  const cwd = process.cwd();
  const tryPath = (p) => {
    if (!p || !existsSync(p)) return null;
    try {
      const raw = readFileSync(p, 'utf8');
      const j = JSON.parse(raw);
      if (j && j.private_key && j.client_email) return j;
    } catch (_) {}
    return null;
  };
  const tryJson = (raw) => {
    try {
      const j = typeof raw === 'string' ? JSON.parse(raw.trim()) : raw;
      if (j && j.private_key && j.client_email) return j;
    } catch (_) {}
    return null;
  };
  const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (gac) {
    const v = tryPath(gac);
    if (v) return { serviceAccount: v, source: 'GOOGLE_APPLICATION_CREDENTIALS' };
  }
  const fpath = process.env.SUPABASE_SERVICE_ACCOUNT_PATH;
  if (fpath) {
    const v = tryPath(fpath);
    if (v) return { serviceAccount: v, source: 'SUPABASE_SERVICE_ACCOUNT_PATH' };
  }
  for (const rel of [
    'functions/serviceAccountKey.json',
    'whatsapp-backend/serviceAccountKey.json',
    'serviceAccountKey.json',
  ]) {
    const v = tryPath(path.join(cwd, rel)) || tryPath(path.join(cwd, '..', rel));
    if (v) return { serviceAccount: v, source: rel };
  }
  return null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { project: null, accountIds: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1]) {
      out.project = args[++i];
      continue;
    }
    if (args[i] === '--accountId' && args[i + 1]) {
      out.accountIds.push(args[++i]);
      continue;
    }
  }
  return out;
}

function formatTs(v) {
  if (v == null) return '—';
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (typeof v === 'number') return new Date(v).toISOString();
  if (typeof v === 'string') return v;
  return String(v);
}

async function main() {
  const { project, accountIds } = parseArgs();
  if (!project || accountIds.length === 0) {
    console.error('Usage: node scripts/check_database_history.mjs --project <id> --accountId <id> [--accountId <id> ...]');
    process.exit(1);
  }

  const loaded = loadServiceAccount();
  try {
    if (loaded) {
      admin.initializeApp({
        credential: admin.credential.cert(loaded.serviceAccount),
        projectId: project,
      });
    } else {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: project,
      });
    }
  } catch (e) {
    console.error('❌ Supabase Admin init failed:', e.message);
    console.error('Use GOOGLE_APPLICATION_CREDENTIALS or gcloud auth application-default login.');
    process.exit(1);
  }

  const db = admin.database();
  const LIMIT = 2000;

  console.log('');
  console.log('🔍 Database istoric – threads per account + lastBackfill / lastHistorySync');
  console.log('─'.repeat(70));
  console.log(`   Project: ${project}`);
  console.log(`   AccountIds: ${accountIds.length}`);
  console.log('');

  let totalThreads = 0;
  const rows = [];

  for (const accountId of accountIds) {
    let threadsCount = 0;
    let newestLastMessageAt = null;
    let lastBackfillAt = null;
    let lastHistorySyncAt = null;
    let phone = null;
    let status = null;
    let messagesInSample = 0;
    let threadsSnap = null;

    try {
      threadsSnap = await db
        .collection('threads')
        .where('accountId', '==', accountId)
        .orderBy('lastMessageAt', 'desc')
        .limit(LIMIT)
        .get();

      threadsCount = threadsSnap.size;
      totalThreads += threadsCount;

      if (threadsSnap.docs.length > 0) {
        const d = threadsSnap.docs[0].data();
        const ts = d.lastMessageAt;
        if (ts && typeof ts.toMillis === 'function') {
          newestLastMessageAt = new Date(ts.toMillis()).toISOString();
        }
      }
    } catch (e) {
      console.error(`❌ threads query failed for ${accountId}:`, e.message);
      if (/failed-precondition|index/i.test(String(e.message))) {
        console.error('   → Missing Database index: threads (accountId ASC, lastMessageAt DESC).');
      }
    }

    // Sample messages in first 3 threads (verify history import)
    if (threadsSnap && threadsSnap.docs.length > 0) {
      const sample = threadsSnap.docs.slice(0, 3);
      for (const t of sample) {
        try {
          const msgs = await t.ref.collection('messages').limit(500).get();
          messagesInSample += msgs.size;
        } catch (e) {
          /* ignore */
        }
      }
    }

    let lastAutoBackfillStatus = null;
    let lastBackfillResult = null;
    let lastAutoBackfillAt = null;
    let lastHistorySyncResult = null;

    try {
      const accSnap = await db.collection('accounts').doc(accountId).get();
      if (accSnap.exists) {
        const d = accSnap.data();
        lastBackfillAt = d.lastBackfillAt;
        lastHistorySyncAt = d.lastHistorySyncAt;
        lastAutoBackfillAt = d.lastAutoBackfillAt;
        lastAutoBackfillStatus = d.lastAutoBackfillStatus ?? null;
        lastBackfillResult = d.lastBackfillResult ?? null;
        lastHistorySyncResult = d.lastHistorySyncResult ?? null;
        phone = d.phone ?? d.phoneNumber ?? null;
        status = d.status ?? null;
      }
    } catch (e) {
      console.warn(`   ⚠️ accounts/${accountId} read failed:`, e.message);
    }

    // Sample first 20 threads: how many have 0 messages? (explains "not synced with phone")
    let threadsWithZeroMsgs = 0;
    let oldestMsgHasKeyId = null; // null | true | false – can backfill use oldest message?
    const sampleSize = 20;
    if (threadsSnap && threadsSnap.docs.length > 0) {
      const sample = threadsSnap.docs.slice(0, sampleSize);
      for (const t of sample) {
        try {
          const msgs = await t.ref.collection('messages').limit(1).get();
          if (msgs.size === 0) threadsWithZeroMsgs++;
        } catch (_) {}
      }
      // Check oldest message (by tsClient asc) in first thread with messages – has key.id for backfill?
      for (const t of threadsSnap.docs) {
        try {
          const oldest = await t.ref.collection('messages').orderBy('tsClient', 'asc').limit(1).get();
          if (oldest.empty) continue;
          const d = oldest.docs[0].data();
          const kid = d?.key?.id || d?.waMessageId || d?.messageId;
          oldestMsgHasKeyId = !!(typeof kid === 'string' && kid.length > 0);
          break;
        } catch (_) {}
      }
    }

    const shortId = accountId.replace('account_prod_', '').slice(0, 12) + '…';
    rows.push({
      accountId: shortId,
      fullId: accountId,
      threadsCount,
      messagesInSample,
      threadsWithZeroMsgs,
      sampleSize: Math.min(sampleSize, threadsSnap?.docs.length ?? 0),
      oldestMsgHasKeyId,
      newestLastMessageAt: newestLastMessageAt ?? '—',
      lastBackfillAt: formatTs(lastBackfillAt),
      lastHistorySyncAt: formatTs(lastHistorySyncAt),
      lastAutoBackfillAt: formatTs(lastAutoBackfillAt),
      lastAutoBackfillStatus,
      lastBackfillResult,
      lastHistorySyncResult,
      phone: phone ?? '—',
      status: status ?? '—',
    });
  }

  for (const r of rows) {
    const run = r.lastAutoBackfillStatus?.running === true;
    console.log(`📬 ${r.accountId}`);
    console.log(`   threads: ${r.threadsCount}  |  messages (first 3 threads, max 500/thread): ${r.messagesInSample}  |  newest: ${r.newestLastMessageAt}`);
    if (r.sampleSize > 0) {
      console.log(`   threads fără mesaje (din primele ${r.sampleSize}): ${r.threadsWithZeroMsgs} — restul au ≥1 mesaj`);
    }
    if (r.oldestMsgHasKeyId !== null) {
      console.log(`   oldest message key.id (pentru backfill): ${r.oldestMsgHasKeyId ? '✅ da' : '❌ nu'}`);
    }
    console.log(`   lastBackfillAt:    ${r.lastBackfillAt}`);
    console.log(`   lastHistorySyncAt: ${r.lastHistorySyncAt}`);
    if (r.lastAutoBackfillAt && r.lastAutoBackfillAt !== '—') {
      console.log(`   lastAutoBackfillAt: ${r.lastAutoBackfillAt}`);
    }
    if (r.lastHistorySyncResult && typeof r.lastHistorySyncResult === 'object') {
      const h = r.lastHistorySyncResult;
      console.log(`   lastHistorySyncResult: saved=${h.saved ?? '—'} skipped=${h.skipped ?? '—'} errors=${h.errors ?? '—'} total=${h.total ?? '—'}`);
    }
    if (run) {
      console.log(`   🔄 BACKFILL ÎN CURS (lastAutoBackfillStatus.running=true)`);
    } else if (r.lastAutoBackfillStatus) {
      const ok = r.lastAutoBackfillStatus.ok === true;
      console.log(`   backfill status: ${ok ? '✅ ok' : '❌ error'} (running=false)`);
      if (!ok && (r.lastAutoBackfillStatus.errorCode || r.lastAutoBackfillStatus.errorMessage)) {
        console.log(`      → ${r.lastAutoBackfillStatus.errorCode || ''} ${r.lastAutoBackfillStatus.errorMessage || ''}`);
      }
    }
    if (r.lastBackfillResult && typeof r.lastBackfillResult === 'object') {
      const br = r.lastBackfillResult;
      console.log(`   lastBackfillResult: threads=${br.threads ?? '—'} messages=${br.messages ?? '—'} errors=${br.errors ?? '—'}`);
    }
    console.log(`   phone: ${r.phone}  status: ${r.status}`);
    console.log('');
  }

  console.log('─'.repeat(70));
  console.log(`   Total threads (sum): ${totalThreads}`);
  const totalMsg = rows.reduce((s, r) => s + (r.messagesInSample || 0), 0);
  console.log(`   Messages sampled (first 3 threads × up to 500 each): ${totalMsg}`);
  const anyRunning = rows.some((r) => r.lastAutoBackfillStatus?.running === true);
  if (anyRunning) {
    console.log('');
    console.log('   🔄 Sincronizare în curs (backfill running) pentru cel puțin un cont.');
    console.log('   Ordinea în aplicație se poate schimba până la finalizare.');
  }
  console.log('');

  const noBackfill = rows.filter((r) => r.lastBackfillAt === '—');
  const noHistorySync = rows.filter((r) => r.lastHistorySyncAt === '—');
  if (noBackfill.length > 0 || noHistorySync.length > 0) {
    console.log('💡 Posibile cauze pentru puțin istoric:');
    if (noHistorySync.length > 0) {
      console.log('   • lastHistorySyncAt lipsă → history sync (pairing) nu a rulat / nu a scris.');
    }
    if (noBackfill.length > 0) {
      console.log('   • lastBackfillAt lipsă → backfill nu a fost rulat pentru acel account.');
    }
    console.log('   • Rulează backfill per account (Manage Accounts → Backfill sau POST /api/whatsapp/backfill/:accountId).');
    console.log('   • Verifică backend Hetzner: waMode=active, database connected, messaging-history.set în logs.');
    console.log('');
  }

  // De ce nu e sincronizat cu telefonul?
  const manyZeroMsgs = rows.some((r) => r.sampleSize > 0 && r.threadsWithZeroMsgs > r.sampleSize * 0.3);
  const backfillZeroMessages = rows.some((r) => {
    const br = r.lastBackfillResult;
    return br && typeof br === 'object' && (br.threads ?? 0) > 0 && (br.messages ?? 0) === 0;
  });
  const noKeyId = rows.some((r) => r.oldestMsgHasKeyId === false);
  if (manyZeroMsgs || backfillZeroMessages || noKeyId || noHistorySync.length > 0 || noBackfill.length > 0) {
    console.log('📱 De ce nu e sincronizat cu telefonul?');
    console.log('─'.repeat(70));
    if (manyZeroMsgs) {
      console.log('   • Multe conversații fără mesaje → WhatsApp (history sync) nu trimite tot istoricul pentru fiecare chat.');
      console.log('     Backfill completează doar thread-urile care au deja ≥1 mesaj. Fără mesaj = niciun backfill.');
    }
    if (noKeyId) {
      console.log('   • Lipsește key.id în mesajele existente → backfill nu poate folosi fetchMessageHistory.');
      console.log('     Backend-ul trebuie să salveze key.id la fiecare mesaj (message_persist).');
    }
    if (backfillZeroMessages && !noKeyId) {
      console.log('   • Backfill a procesat thread-uri dar 0 mesaje noi → probabil toate aveau deja istoricul');
      console.log('     sau fetchMessageHistory returnează gol (timeout, limită WhatsApp).');
    } else if (backfillZeroMessages) {
      console.log('   • Backfill 0 mesaje + lipsă key.id → vezi punctul despre key.id mai sus.');
    }
    if (noHistorySync.length > 0) {
      console.log('   • lastHistorySyncAt lipsă → Reîmperechează contul (Disconnect → Connect → scan QR) pentru history sync.');
    }
    if (noBackfill.length > 0) {
      console.log('   • lastBackfillAt lipsă → Rulează backfill din app (Sync/Backfill) sau așteaptă auto-backfill.');
    }
    console.log('   • Ce poți face: Reîmperechează pentru history sync complet; lasă backfill-ul să ruleze (auto la ~12 min).');
    console.log('');
  }
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
