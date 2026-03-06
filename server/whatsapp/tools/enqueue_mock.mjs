/**
 * tools/enqueue_mock.mjs — Gate A mock pipeline test
 * Injects N fake events into wa-events queue and verifies:
 * - Worker processes all of them
 * - 0 loss (check Supabase count)
 * - 0 duplicates (UNIQUE constraint)
 * - DLQ depth = 0
 *
 * Usage:
 *   node tools/enqueue_mock.mjs [count] [concurrency]
 *   node tools/enqueue_mock.mjs 10000 50
 */
import { readFileSync } from 'fs';
import pathMod from 'path';
import { fileURLToPath } from 'url';

// Load .env
const __dir = pathMod.dirname(fileURLToPath(import.meta.url));
const envPath = pathMod.join(__dir, '..', '.env');
const lines = readFileSync(envPath, 'utf8').split('\n');
for (const l of lines) { const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/); if (m) process.env[m[1]] = m[2]; }

import { Queue } from 'bullmq';
import { createClient } from '@supabase/supabase-js';

const REDIS = { host: process.env.REDIS_HOST || '127.0.0.1', port: 6379, maxRetriesPerRequest: null };
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const eventsQueue = new Queue('wa-events', { connection: REDIS });
const dlqQueue   = new Queue('wa-dlq',     { connection: REDIS });

const COUNT       = parseInt(process.argv[2] || '10000', 10);
const BATCH_SIZE  = parseInt(process.argv[3] || '200',   10);

// Use a fixed mock account ID for Gate A (not a real WA account)
const MOCK_ACCOUNT = 'GATE_A_MOCK_ACCOUNT';
const MOCK_JID     = 'gatea@s.whatsapp.net';

const GATE_A_PREFIX = 'GATEA_' + Date.now() + '_';

console.log(`\n[Gate A] Injecting ${COUNT} mock events (batch=${BATCH_SIZE})...`);
const t0 = Date.now();

// Inject in batches
let enqueued = 0;
for (let batch = 0; batch < Math.ceil(COUNT / BATCH_SIZE); batch++) {
  const jobs = [];
  for (let i = 0; i < BATCH_SIZE && enqueued < COUNT; i++, enqueued++) {
    const msgId = GATE_A_PREFIX + enqueued;
    jobs.push({
      name: 'messages.upsert',
      data: {
        accountId: MOCK_ACCOUNT,
        eventType: 'messages.upsert',
        ts: Math.floor(Date.now() / 1000),
        meta: { jid: MOCK_JID, messageId: msgId, fromMe: false, type: 'notify' },
        payload: {
          key: { remoteJid: MOCK_JID, id: msgId, fromMe: false },
          message: { conversation: `Gate A test message ${enqueued}` },
          messageTimestamp: Math.floor(Date.now() / 1000),
          pushName: 'GateA Mock',
        },
      },
      opts: {
        jobId: 'msg_' + MOCK_ACCOUNT + '_' + msgId,
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 12,
        backoff: { type: 'exponential', delay: 5000 },
      },
    });
  }
  await eventsQueue.addBulk(jobs);
  if ((batch + 1) % 10 === 0 || enqueued >= COUNT) {
    process.stdout.write(`\r  Enqueued: ${enqueued}/${COUNT} (${Math.round(1000*(batch+1)*BATCH_SIZE/(Date.now()-t0))}/s)   `);
  }
}

console.log(`\n[Gate A] All ${COUNT} events enqueued in ${((Date.now()-t0)/1000).toFixed(1)}s`);
console.log('[Gate A] Waiting for worker to process queue...');

// Poll until queue empties
const MAX_WAIT_S = 120;
const start = Date.now();
let prevDepth = COUNT;
while (true) {
  await new Promise(r => setTimeout(r, 2000));
  const counts = await eventsQueue.getJobCounts('waiting', 'active', 'delayed');
  const depth  = counts.waiting + counts.active + counts.delayed;
  const dlqCounts = await dlqQueue.getJobCounts('waiting', 'active', 'failed');
  const dlqDepth  = dlqCounts.waiting + dlqCounts.active + dlqCounts.failed;

  const elapsed = Math.round((Date.now()-start)/1000);
  process.stdout.write(`\r  Queue depth: ${depth} | DLQ: ${dlqDepth} | elapsed: ${elapsed}s   `);

  if (depth === 0) break;
  if (elapsed > MAX_WAIT_S) {
    console.log(`\n[Gate A] TIMEOUT after ${MAX_WAIT_S}s. Depth still ${depth}. Check worker logs.`);
    process.exit(1);
  }
  prevDepth = depth;
}

const elapsed = ((Date.now()-start)/1000).toFixed(1);
console.log(`\n[Gate A] Queue empty after ${elapsed}s`);

// Final DLQ check
const dlqFinal = await dlqQueue.getJobCounts('waiting', 'active', 'failed');
const dlqDepth = dlqFinal.waiting + dlqFinal.active + dlqFinal.failed;
console.log(`[Gate A] DLQ depth: ${dlqDepth} ${dlqDepth === 0 ? '✅' : '❌ FAIL — check DLQ'}`);

// Supabase check — count messages from MOCK_ACCOUNT
const { data, error, count } = await sb
  .from('messages')
  .select('message_id', { count: 'exact', head: true })
  .eq('account_id', MOCK_ACCOUNT)
  .like('message_id', GATE_A_PREFIX + '%');

const written = count || 0;
console.log(`[Gate A] Supabase rows written: ${written}/${COUNT} ${written === COUNT ? '✅' : '⚠️  partial (duplicates suppressed or errors)'}`);

if (dlqDepth === 0 && written === COUNT) {
  console.log('\n🎉 GATE A PASSED — 0 loss, 0 DLQ, all written to Supabase\n');
  process.exit(0);
} else {
  console.log('\n❌ GATE A FAILED — see above for details\n');
  process.exit(1);
}
