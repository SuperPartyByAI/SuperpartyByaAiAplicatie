/**
 * wa-reconciler.mjs — Watchdog / Cron process (pm2, restarts every 5 min)
 * Checks: queue depth, DLQ, CONNECTED sessions, stale sessions
 */
import { readFileSync } from 'node:fs';
import pathMod from 'node:path';
import { fileURLToPath } from 'node:url';

(function loadEnv() {
  try {
    const __dir = pathMod.dirname(fileURLToPath(import.meta.url));
    const envPath = pathMod.join(__dir, '.env');
    if (readFileSync && readFileSync(envPath)) {
      const lines = readFileSync(envPath, 'utf8').split('\n');
      for (const l of lines) { const m = l.match(/^([A-Za-z_]\w*)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
    }
  } catch {}
})();

import { Queue } from 'bullmq';
import createRedis from 'ioredis';
import { createClient } from '@supabase/supabase-js';

const REDIS = { host: process.env.REDIS_HOST || '127.0.0.1', port: 6379, maxRetriesPerRequest: null };
const sb    = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const eventsQ = new Queue('wa-events', { connection: REDIS });
const dlqQ    = new Queue('wa-dlq',    { connection: REDIS });

// Thresholds
const QUEUE_DEPTH_ALERT   = Number.parseInt(process.env.QUEUE_DEPTH_ALERT   || '1000', 10);
const DLQ_ALERT_THRESHOLD = Number.parseInt(process.env.DLQ_ALERT_THRESHOLD || '0',    10);
const MIN_CONNECTED_PCTG  = Number.parseFloat(process.env.MIN_CONNECTED_PCTG || '0.5');

async function run() {
  const ts = new Date().toISOString();
  console.log(`[Reconciler] Run at ${ts}`);

  // 1) Queue depth
  const evCounts = await eventsQ.getJobCounts('waiting', 'active', 'delayed', 'failed');
  const qDepth   = evCounts.waiting + evCounts.active + evCounts.delayed;
  const qFailed  = evCounts.failed;
  console.log(`[Reconciler] wa-events depth=${qDepth} failed=${qFailed}`);
  if (qDepth > QUEUE_DEPTH_ALERT) {
    console.error(`[Reconciler] ⚠️  ALERT: wa-events queue depth=${qDepth} > ${QUEUE_DEPTH_ALERT} — worker or DB problem!`);
  }

  // 2) DLQ depth
  const dlqCounts = await dlqQ.getJobCounts('waiting', 'active', 'failed');
  const dlqDepth  = dlqCounts.waiting + dlqCounts.active + dlqCounts.failed;
  console.log(`[Reconciler] wa-dlq depth=${dlqDepth}`);
  if (dlqDepth > DLQ_ALERT_THRESHOLD) {
    console.error(`[Reconciler] ⚠️  ALERT: DLQ depth=${dlqDepth} — investigate failed jobs!`);
  }

  // 3) Session CONNECTED ratio from Supabase
  try {
    const { count: totalCount, error: e1 }     = await sb.from('wa_accounts').select('*', { count: 'exact', head: true });
    const { count: connectedCount, error: e2 } = await sb.from('wa_accounts').select('*', { count: 'exact', head: true }).eq('state', 'connected');
    if (e1 || e2) throw new Error((e1 || e2).message);
    const total     = totalCount     ?? 0;
    const connected = connectedCount ?? 0;
    console.log(`[Reconciler] Sessions: ${connected}/${total} connected`);
    if (total > 0 && connected / total < MIN_CONNECTED_PCTG) {
      console.error(`[Reconciler] ⚠️  ALERT: Only ${connected}/${total} accounts CONNECTED (< ${MIN_CONNECTED_PCTG*100}%)`);
    }
  } catch (e) {
    console.error('[Reconciler] Failed to check session states:', e.message);
  }

  // 4) Redis AOF health
  try {
    const redis = new createRedis(REDIS);
    const info = await redis.info('persistence');
    const aofEnabled = /aof_enabled:1/.test(info);
    const aofStatus  = info.match(/aof_last_write_status:(\w+)/)?.[1] || 'unknown';
    console.log(`[Reconciler] Redis AOF enabled=${aofEnabled} last_write=${aofStatus}`);
    if (!aofEnabled)   console.error('[Reconciler] ⚠️  ALERT: Redis AOF is DISABLED! Durability at risk!');
    if (aofStatus !== 'ok') console.error(`[Reconciler] ⚠️  ALERT: Redis AOF write status: ${aofStatus}`);
    redis.disconnect();
  } catch (e) {
    console.error('[Reconciler] Redis check failed:', e.message);
  }

  console.log('[Reconciler] Done.\n');
  // process completes — pm2 cron_restart handles scheduling
}

await run().catch(e => { console.error('[Reconciler] Fatal:', e); process.exit(1); });
