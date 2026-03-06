/**
 * wa-worker.mjs — BullMQ consumer (separate pm2 process)
 * Reads from wa-events + wa-media queues and writes to Supabase idempotently.
 */
import 'dotenv/config';
import { Worker, Queue, QueueEvents } from 'bullmq';
import { createRequire } from 'module';
import fsSync from 'fs';
import pathMod from 'path';
import { fileURLToPath } from 'url';

// ── Load env ────────────────────────────────────────────────
(function loadEnv() {
  try {
    const __dir = pathMod.dirname(fileURLToPath(import.meta.url));
    const envPath = pathMod.join(__dir, '.env');
    if (fsSync.existsSync(envPath)) {
      const lines = fsSync.readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
      }
    }
  } catch (e) { /* ignore */ }
})();

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { resolveOrCreateIdentity } from './lib/identity-resolver.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

if (!SUPABASE_KEY) {
  console.error('[WA-Worker] CRITICAL: SUPABASE_SERVICE_KEY missing');
  process.exit(1);
}

const REDIS_OPTS = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null,
};

const dlqQueue = new Queue('wa-dlq', { connection: REDIS_OPTS });

// ── Text extraction helper ─────────────────────────────────
function extractText(msg) {
  const m = msg.message;
  if (!m) return '';
  return m.conversation
    || m.extendedTextMessage?.text
    || m.imageMessage?.caption
    || m.videoMessage?.caption
    || m.documentMessage?.caption
    || '';
}

function hasMedia(msg) {
  const m = msg.message || {};
  return !!(m.imageMessage || m.videoMessage || m.audioMessage || m.documentMessage || m.stickerMessage);
}

// ── Canonical JID helper ──────────────────────────────────
function canonicalJid(jid) {
  if (!jid) return jid;
  // normalise @lid → @s.whatsapp.net  (Baileys v6 uses @lid sometimes)
  return jid.replace('@lid', '@s.whatsapp.net');
}

// ── Account label cache (per-process, refreshed on miss) ─────
const _labelCache = {};
async function getAccountLabel(accountId) {
  if (_labelCache[accountId]) return _labelCache[accountId];
  const { data } = await sb.from('wa_accounts').select('label').eq('id', accountId).single();
  _labelCache[accountId] = data?.label || accountId;
  return _labelCache[accountId];
}

// ── Upsert message to Supabase ────────────────────────────
async function upsertMessage(accountId, msg) {
  // 1) Resolve canonical identity (idempotent)
  const jidRaw   = msg.key?.remoteJid || '';
  const jid      = canonicalJid(jidRaw) || jidRaw;
  const messageId    = msg.key?.id || '';
  const fromMe       = msg.key?.fromMe || false;
  const ts           = msg.messageTimestamp ? Number(msg.messageTimestamp) : Math.floor(Date.now() / 1000);
  const text         = extractText(msg);
  const direction    = fromMe ? 'out' : 'in';
  const isMedia      = hasMedia(msg);
  const accountLabel = await getAccountLabel(accountId);

  const identity = await resolveOrCreateIdentity(sb, accountId, jidRaw, msg.pushName || null).catch(e => {
    console.error('[WA-Worker] identity resolve failed:', e.message);
    return { identityId: null, phone_e164: null, displayName: msg.pushName || jidRaw.split('@')[0], resolution_status: 'unresolved' };
  });

  // 2) Ensure conversation exists — write all fields Flutter ChatListScreen needs
  const convId = `${accountId}_${jid}`;
  const lastPreview = text ? text.slice(0, 100) : (isMedia ? '[Media]' : '');
  await sb.from('conversations').upsert({
    id:                   convId,
    account_id:           accountId,
    account_label:        accountLabel,
    jid,
    identity_id:          identity.identityId,
    client_display_name:  identity.displayName || null,
    phone:                identity.phone_e164 || null,
    last_message_at:      ts,
    last_message_preview: lastPreview,
    updated_at:           new Date(ts * 1000).toISOString(),
  }, { onConflict: 'id', ignoreDuplicates: false });

  // 3) Upsert message
  const { error } = await sb.from('messages').upsert({
    id:              randomUUID(),  // required PK — will be ignored on conflict
    account_id:      accountId,
    message_id:      messageId,
    conversation_id: convId,
    direction,
    text,
    type:            isMedia ? 'media' : 'text',
    from_me:         fromMe,
    push_name:       msg.pushName || null,
    timestamp:       ts,
    ts,
    status:          fromMe ? 'sent' : 'received',
    created_at:      new Date(ts * 1000).toISOString(),
  }, { onConflict: 'account_id,message_id', ignoreDuplicates: true });

  if (error) throw new Error(`Supabase upsert error: ${error.message}`);
}

// ── Update message status ─────────────────────────────────
async function processUpdate(accountId, upd) {
  const messageId = upd.key?.id || '';
  if (!messageId) return;
  const status = upd.update?.status;
  if (!status && status !== 0) return;

  // Map Baileys status codes to strings
  const STATUS_MAP = { 0: 'pending', 1: 'sent', 2: 'delivered', 3: 'read', 4: 'played' };
  const statusStr = STATUS_MAP[status] || String(status);

  await sb.from('messages')
    .update({ status: statusStr })
    .eq('account_id', accountId)
    .eq('message_id', messageId);
}

// ── Events Worker ─────────────────────────────────────────
const eventsWorker = new Worker('wa-events', async job => {
  const { accountId, eventType, payload } = job.data;

  if (!accountId) throw new Error('Missing accountId in job');

  if (eventType === 'messages.upsert') {
    await upsertMessage(accountId, payload);
  } else if (eventType === 'messages.update') {
    await processUpdate(accountId, payload);
  }
}, {
  connection: REDIS_OPTS,
  concurrency: parseInt(process.env.WORKER_CONCURRENCY || '8', 10),
});

// ── Media Worker (stub — extend with actual upload logic) ──
const mediaWorker = new Worker('wa-media', async job => {
  const { accountId, messageId, jid } = job.data;
  // TODO: download media from Baileys store + upload to Supabase Storage
  // For now just log — media already partially written by main process
  console.log(`[WA-Worker] media job skipped (stub): ${accountId} ${messageId}`);
}, {
  connection: REDIS_OPTS,
  concurrency: 2,
});

// ── DLQ: move failed jobs after exhausted retries ────────
eventsWorker.on('failed', async (job, err) => {
  if (job && job.attemptsMade >= (job.opts.attempts || 12)) {
    console.error(`[WA-Worker] DLQ: job ${job.id} exhausted retries:`, err.message);
    await dlqQueue.add('failed', {
      originalQueue: 'wa-events',
      jobId: job.id,
      data: job.data,
      error: err.message,
      failedAt: new Date().toISOString(),
    });
  } else {
    console.warn(`[WA-Worker] job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
  }
});

mediaWorker.on('failed', (job, err) => {
  console.warn(`[WA-Worker] media job ${job?.id} failed:`, err.message);
});

// ── Health log ────────────────────────────────────────────
eventsWorker.on('completed', job => {
  // only log occasionally to avoid spam
  if (Math.random() < 0.02) console.log(`[WA-Worker] completed: ${job.id}`);
});

console.log('[WA-Worker] Started. Listening on wa-events + wa-media queues.');

// ── Graceful shutdown ─────────────────────────────────────
async function shutdown() {
  console.log('[WA-Worker] Shutting down gracefully...');
  await eventsWorker.close();
  await mediaWorker.close();
  process.exit(0);
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
