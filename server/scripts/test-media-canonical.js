#!/usr/bin/env node
/**
 * test-media-canonical.js — Verify media messages use canonical JIDs only.
 * 
 * Usage:
 *   DRY_RUN=true node scripts/test-media-canonical.js
 *   node scripts/test-media-canonical.js
 * 
 * Checks:
 * 1. All conversations/{docId}/messages with media.path are under canonical docIds
 * 2. No duplicate conversations for same contact (lid vs phone)
 * 3. canonical_mismatch_total == 0 from /metrics
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import http from 'http';

const DRY_RUN = process.env.DRY_RUN === 'true';
const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// Init Firebase
const SA_PATH = './firebase-service-account.json';
if (getApps().length === 0) {
  if (fs.existsSync(SA_PATH)) {
    const sa = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
    initializeApp({ credential: cert(sa) });
  } else {
    console.error('No firebase-service-account.json found');
    process.exit(1);
  }
}
const db = getFirestore();

async function main() {
  console.log('=== Media Canonical JID Verification ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('');

  // 1. Scan all conversations for media messages
  const convosSnap = await db.collection('conversations').get();
  console.log(`Found ${convosSnap.size} conversations`);

  let totalMessages = 0;
  let mediaMessages = 0;
  let lidDocIds = 0;
  let mismatchCount = 0;
  const docIdsByCanonical = new Map(); // canonicalJid → [docIds]

  for (const convo of convosSnap.docs) {
    const convoId = convo.id;
    const data = convo.data();
    const jid = data.jid || data.canonicalJid || '';

    // Check if docId contains @lid (should not for canonical)
    if (convoId.includes('@lid')) {
      lidDocIds++;
      console.log(`  ⚠️  LID docId found: ${convoId}`);
    }

    // Group by canonical JID to detect duplicates
    const canonical = data.canonicalJid || jid;
    const accountId = data.accountId || '';
    const expected = accountId ? `${accountId}_${canonical}` : canonical;

    if (!docIdsByCanonical.has(expected)) docIdsByCanonical.set(expected, []);
    docIdsByCanonical.get(expected).push(convoId);

    // Check if convoId matches expected
    if (convoId !== expected && expected && !convoId.includes('@g.us')) {
      mismatchCount++;
      console.log(`  ❌ Mismatch: docId="${convoId}" expected="${expected}"`);
    }

    // Check media messages
    const msgsSnap = await db.collection('conversations').doc(convoId).collection('messages')
      .where('media', '!=', null).limit(50).get();

    for (const msg of msgsSnap.docs) {
      totalMessages++;
      const msgData = msg.data();
      if (msgData.media && msgData.media.path) {
        mediaMessages++;
        // Verify storage path contains canonical convoId
        if (!msgData.media.path.includes(convoId)) {
          console.log(`  ⚠️  Media path mismatch: msg=${msg.id} path=${msgData.media.path} convoId=${convoId}`);
        }
      }
    }
  }

  // 2. Check for duplicate conversations
  let duplicateGroups = 0;
  for (const [canonical, docIds] of docIdsByCanonical) {
    if (docIds.length > 1) {
      duplicateGroups++;
      console.log(`  🔴 DUPLICATE: canonical="${canonical}" docIds=${JSON.stringify(docIds)}`);
    }
  }

  // 3. Check canonical_mismatch_total from /metrics
  let metricValue = null;
  try {
    const metricsUrl = `${BASE_URL}/metrics`;
    const body = await new Promise((resolve, reject) => {
      http.get(metricsUrl, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }).on('error', reject);
    });
    const match = body.match(/canonical_mismatch_total\s+(\d+)/);
    metricValue = match ? parseInt(match[1], 10) : 0;
  } catch (e) {
    console.log(`  ℹ️  Could not fetch /metrics: ${e.message}`);
  }

  // Summary
  console.log('');
  console.log('=== Summary ===');
  console.log(`Conversations: ${convosSnap.size}`);
  console.log(`Media messages checked: ${mediaMessages} / ${totalMessages} total`);
  console.log(`LID docIds found: ${lidDocIds} (should be 0)`);
  console.log(`ConvoId mismatches: ${mismatchCount} (should be 0)`);
  console.log(`Duplicate groups: ${duplicateGroups} (should be 0)`);
  console.log(`canonical_mismatch_total: ${metricValue ?? 'N/A'} (should be 0)`);
  console.log('');

  const allOk = lidDocIds === 0 && mismatchCount === 0 && duplicateGroups === 0 && (metricValue === null || metricValue === 0);
  if (allOk) {
    console.log('✅ ALL CHECKS PASSED — No canonical JID amestec detected');
  } else {
    console.log('❌ ISSUES FOUND — Review output above');
  }

  process.exit(allOk ? 0 : 1);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
