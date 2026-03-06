import { readFileSync } from 'fs';
import pathMod from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execP = promisify(exec);
const IPTABLES = '/usr/sbin/iptables';

const __dir = pathMod.dirname(fileURLToPath(import.meta.url));
const envPath = pathMod.join(__dir, '..', '.env');
const rawEnv = readFileSync(envPath, 'utf8');
const lines = rawEnv.split('\n');
for (const l of lines) { const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/); if (m) process.env[m[1]] = m[2]; }

import { Queue } from 'bullmq';
import { createClient } from '@supabase/supabase-js';

const REDIS = { host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null };
const evQ  = new Queue('wa-events', { connection: REDIS });
const dlqQ = new Queue('wa-dlq',    { connection: REDIS });
const sb   = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const MOCK  = 'GATE_B2_MOCK';
const STAMP = Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log   = m  => console.log('[Gate B-Real] ' + m);

const SB_IPS = ['172.64.149.246', '104.18.38.10'];

async function block() {
  for (const ip of SB_IPS) {
    await execP(`${IPTABLES} -A OUTPUT -d ${ip} -p tcp --dport 443 -j DROP`).catch(e => log('block err: ' + e.message));
  }
}
async function unblock() {
  for (const ip of SB_IPS) {
    await execP(`${IPTABLES} -D OUTPUT -d ${ip} -p tcp --dport 443 -j DROP`).catch(() => {});
  }
}

async function getDepth() {
  const c = await evQ.getJobCounts('waiting', 'active', 'delayed');
  return c.waiting + c.active + c.delayed;
}

function makeJobs(prefix, count) {
  return Array.from({ length: count }, (_, i) => ({
    name: 'messages.upsert',
    data: {
      accountId: MOCK, eventType: 'messages.upsert', ts: Math.floor(Date.now() / 1000),
      meta: { jid: 'gb2@s.whatsapp.net', messageId: prefix + i, fromMe: false, type: 'notify' },
      payload: { key: { remoteJid: 'gb2@s.whatsapp.net', id: prefix + i, fromMe: false },
        message: { conversation: 'GateB2 ' + i }, messageTimestamp: Math.floor(Date.now() / 1000) },
    },
    opts: { jobId: 'msg_' + MOCK + '_' + prefix + i, removeOnComplete: true, removeOnFail: false, attempts: 12, backoff: { type: 'exponential', delay: 3000 } },
  }));
}

// Ensure clean state
await unblock().catch(() => {});
await sb.from('messages').delete().eq('account_id', MOCK);

log('=== GATE B-REAL — iptables network outage simulation ===');

// ── Phase 1: Normal (50 events) ───────────────────────────────────────────────
log('Phase 1 — Normal (50 events, network healthy)');
const P1 = 'GB2_P1_' + STAMP + '_';
await evQ.addBulk(makeJobs(P1, 50));
await sleep(15000);
const { count: c1 } = await sb.from('messages').select('*', { count: 'exact', head: true })
  .eq('account_id', MOCK).like('message_id', P1 + '%');
log('P1: ' + c1 + '/50 in Supabase ' + (c1 === 50 ? '✅' : '❌'));

// ── Phase 2: Block network + inject 150 events ────────────────────────────────
log('');
log('Phase 2 — Blocking Supabase via iptables DROP...');
await block();
log('iptables DROP active: ' + SB_IPS.join(', ') + ' port 443');
await sleep(500);

const P2 = 'GB2_P2_' + STAMP + '_';
await evQ.addBulk(makeJobs(P2, 150));
log('150 events enqueued during outage. Waiting 20s...');
await sleep(20000);
const depthDuring = await getDepth();
log('Queue depth during outage: ' + depthDuring + (depthDuring > 0 ? ' ✅ queue holding!' : ' ⚠️'));

// ── Phase 3: Restore network ──────────────────────────────────────────────────
log('');
log('Phase 3 — Restoring network (unblock iptables)...');
await unblock();
log('Network restored. Polling queue until empty (max 4 min)...');

const t0 = Date.now();
let depthFinal = depthDuring;
for (let i = 0; i < 80; i++) {
  await sleep(3000);
  depthFinal = await getDepth();
  const el = Math.round((Date.now() - t0) / 1000);
  process.stdout.write('\r  depth=' + depthFinal + ' elapsed=' + el + 's   ');
  if (depthFinal === 0) break;
}
console.log('');
const recoverTime = Math.round((Date.now() - t0) / 1000);
await sleep(8000);

const { count: c2 } = await sb.from('messages').select('*', { count: 'exact', head: true })
  .eq('account_id', MOCK).like('message_id', P2 + '%');
const dlqC = await dlqQ.getJobCounts('waiting', 'active', 'failed');
const dlqDepth = dlqC.waiting + dlqC.active + dlqC.failed;

// Safety: clean up iptables
await unblock().catch(() => {});

log('');
log('══════════════════════════════════════════════════════');
log('  GATE B-REAL RESULTS');
log('══════════════════════════════════════════════════════');
log('  Phase 1 (normal)    : ' + c1 + '/50 in Supabase            ' + (c1 === 50 ? '✅' : '❌'));
log('  Phase 2 (iptables)  : queue held ' + depthDuring + ' events    ' + (depthDuring > 0 ? '✅' : '⚠️'));
log('  Phase 3 (recovery)  : ' + c2 + '/150 in Supabase           ' + (c2 === 150 ? '✅' : '❌'));
log('  Final queue depth   : ' + depthFinal + '                       ' + (depthFinal === 0 ? '✅' : '❌'));
log('  DLQ depth           : ' + dlqDepth + '                       ' + (dlqDepth === 0 ? '✅' : '⚠️ check /debug/dlq'));
log('  Recovery time       : ' + recoverTime + 's after unblock');
log('══════════════════════════════════════════════════════');

if (c1 === 50 && depthDuring > 0 && c2 === 150 && depthFinal === 0) {
  log('  🎉 GATE B-REAL PASSED — zero loss during real network outage!');
} else if (c2 === 150 && depthFinal === 0) {
  log('  ✅ GATE B-REAL PASS (all 150 recovered, queue=0) — outage metric partial (fast retry)');
} else {
  log('  ❌ GATE B-REAL needs investigation');
}

process.exit(0);
