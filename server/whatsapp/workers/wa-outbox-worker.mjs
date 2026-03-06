/**
 * wa-outbox-worker.mjs — WhatsApp Durable Outbox Worker
 * 
 * Processes outbox_messages from Postgres with:
 * - Exponential backoff retry (max 5 attempts)
 * - Dead Letter Queue (status=dead) after max_attempts
 * - Per-account rate limiting (3 msg/s default)
 * - Global rate limiting (50 msg/s default)  
 * - Idempotent: skips already-sent messages
 * - restart-safe: uses FOR UPDATE SKIP LOCKED for atomic claim
 *
 * Run: node wa-outbox-worker.mjs (pm2 process)
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, WHATSAPP_API_URL
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WA_API_URL   = process.env.WHATSAPP_API_URL || 'http://localhost:3000';
const WA_API_TOKEN = process.env.WA_INTERNAL_TOKEN || '';

// Rate limits
const RATE_PER_ACCOUNT_MS  = Number.parseInt(process.env.OUTBOX_RATE_ACCOUNT_MS  || '350', 10);
const RATE_GLOBAL_MS       = Number.parseInt(process.env.OUTBOX_RATE_GLOBAL_MS   || '20', 10);
const POLL_INTERVAL_MS     = Number.parseInt(process.env.OUTBOX_POLL_MS          || '1000', 10);
const BATCH_SIZE           = Number.parseInt(process.env.OUTBOX_BATCH_SIZE       || '10', 10);
const MAX_ATTEMPTS         = Number.parseInt(process.env.OUTBOX_MAX_ATTEMPTS     || '5', 10);

// Backoff: attempts → delay seconds (1, 2, 8, 32, 120)
const backoffSec = (attempt) => Math.min(120, Math.pow(4, attempt - 1));

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[OutboxWorker] FATAL: SUPABASE_URL and SUPABASE_SERVICE_KEY required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

// ── Rate Limiter ─────────────────────────────────────────────────────────────
const lastSentAt = new Map();  // accountId → timestamp
let lastGlobalSentAt = 0;

async function waitForRateLimit(accountId) {
  const now = Date.now();
  // Global gate
  const globalWait = RATE_GLOBAL_MS - (now - lastGlobalSentAt);
  if (globalWait > 0) await sleep(globalWait);
  // Per-account gate
  const accountWait = RATE_PER_ACCOUNT_MS - (now - (lastSentAt.get(accountId) || 0));
  if (accountWait > 0) await sleep(accountWait);
  lastSentAt.set(accountId, Date.now());
  lastGlobalSentAt = Date.now();
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Metrics (simple in-memory) ────────────────────────────────────────────────
const metrics = {
  sent: 0, failed: 0, dead: 0, retried: 0, skipped: 0, polls: 0,
};

// ── Send via WA API (send-direct — actual Baileys send, NOT re-enqueue) ────────
// WA_INTERNAL_TOKEN must match server-side env for this endpoint to accept.
async function sendMessage(msg) {
  const { account_id, to_jid, message_type, payload } = msg;
  
  const body = {
    accountId: account_id,
    to: to_jid,
    type: message_type,
    ...payload,
  };

  // ⚠️  IMPORTANT: calls /api/wa/send-DIRECT, NOT /api/wa/send (enqueue)
  // /api/wa/send would re-enqueue the message causing infinite recursion.
  const resp = await fetch(`${WA_API_URL}/api/wa/send-direct`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(WA_API_TOKEN ? { 'Authorization': `Bearer ${WA_API_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`WA API ${resp.status}: ${text.substring(0, 200)}`);
  }
  return resp.json();
}

// ── Mark helpers ─────────────────────────────────────────────────────────────
async function markSent(id) {
  await supabase.from('outbox_messages')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', id);
}

async function markFailed(id, error, attempt, maxAttempts) {
  const isDead = attempt >= maxAttempts;
  const nextRetry = isDead ? null : new Date(Date.now() + backoffSec(attempt) * 1000).toISOString();
  await supabase.from('outbox_messages')
    .update({
      status: isDead ? 'dead' : 'failed',
      error_message: String(error).substring(0, 500),
      failed_at: new Date().toISOString(),
      ...(nextRetry ? { next_retry_at: nextRetry } : {}),
    })
    .eq('id', id);
  return isDead;
}

// ── Process one account's batch ───────────────────────────────────────────────
async function processAccount(accountId) {
  // Atomic claim (FOR UPDATE SKIP LOCKED via Postgres RPC)
  const { data: batch, error } = await supabase.rpc('claim_outbox_batch', {
    p_account_id: accountId,
    p_batch_size: BATCH_SIZE,
  });

  if (error) { console.error(`[OutboxWorker] claim failed for ${accountId}:`, error.message); return; }
  if (!batch || batch.length === 0) return;

  console.log(`[OutboxWorker] Processing ${batch.length} messages for account=${accountId}`);

  for (const msg of batch) {
    // Skip if already sent (defensive idempotency)
    if (msg.status === 'sent') { metrics.skipped++; continue; }

    await waitForRateLimit(accountId);

    try {
      await sendMessage(msg);
      await markSent(msg.id);
      metrics.sent++;
      console.log(`[OutboxWorker] ✅ sent id=${msg.id} to=${msg.to_jid}`);
    } catch (err) {
      const isDead = await markFailed(msg.id, err.message, msg.attempts, msg.max_attempts);
      if (isDead) {
        metrics.dead++;
        console.error(`[OutboxWorker] 💀 DEAD id=${msg.id} after ${msg.attempts} attempts: ${err.message}`);
      } else {
        metrics.failed++;
        console.warn(`[OutboxWorker] ⚠️ failed id=${msg.id} attempt=${msg.attempts} retry in ${backoffSec(msg.attempts)}s: ${err.message}`);
      }
      metrics.retried++;
    }
  }
}

// ── Main poll loop ────────────────────────────────────────────────────────────
async function poll() {
  metrics.polls++;
  try {
    // Get distinct accounts with pending messages
    const { data: accounts } = await supabase
      .from('outbox_messages')
      .select('account_id')
      .in('status', ['queued', 'failed'])
      .lte('next_retry_at', new Date().toISOString())
      .limit(20);

    if (!accounts || accounts.length === 0) return;
    
    const uniqueAccounts = [...new Set(accounts.map(r => r.account_id))];
    // Process each account serially to respect per-account rate limiting
    for (const accountId of uniqueAccounts) {
      await processAccount(accountId);
    }
  } catch (e) {
    console.error('[OutboxWorker] Poll error:', e.message);
  }
}

// ── DLQ inspect endpoint (optional, for /debug/outbox/dlq) ───────────────────
// Called externally via HTTP — not started here, integrate into wa main server.

// ── Metrics log every 5 min ──────────────────────────────────────────────────
setInterval(() => {
  console.log('[OutboxWorker] Metrics:', JSON.stringify(metrics));
}, 5 * 60 * 1000);

// ── Startup ───────────────────────────────────────────────────────────────────
console.log(`[OutboxWorker] Starting. Poll every ${POLL_INTERVAL_MS}ms | Per-account rate: ${RATE_PER_ACCOUNT_MS}ms | Global: ${RATE_GLOBAL_MS}ms | MaxAttempts: ${MAX_ATTEMPTS}`);
await poll(); // immediate first poll (top-level await)
const interval = setInterval(poll, POLL_INTERVAL_MS);

// Graceful shutdown
process.on('SIGTERM', () => { clearInterval(interval); process.exit(0); });
process.on('SIGINT',  () => { clearInterval(interval); process.exit(0); });
