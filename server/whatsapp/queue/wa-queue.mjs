/**
 * wa-queue.mjs — BullMQ producer helper
 * Used by the main Baileys process to enqueue events durably into Redis.
 */
import 'dotenv/config';
import { Queue } from 'bullmq';

const REDIS_OPTS = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null,
};

const JOB_DEFAULTS = {
  removeOnComplete: true,
  removeOnFail: false,   // keep failed jobs for DLQ inspection
  attempts: 12,
  backoff: { type: 'exponential', delay: 5000 },
};

export const waEventsQueue  = new Queue('wa-events',  { connection: REDIS_OPTS, defaultJobOptions: JOB_DEFAULTS });
export const waMediaQueue   = new Queue('wa-media',   { connection: REDIS_OPTS, defaultJobOptions: JOB_DEFAULTS });
export const waDlq          = new Queue('wa-dlq',     { connection: REDIS_OPTS });

/**
 * Enqueue a messages.upsert event.
 * Called from the Baileys messages.upsert handler.
 */
export async function enqueueMessages(accountId, messages, type) {
  for (const msg of messages) {
    const jid     = msg.key?.remoteJid || '';
    const msgId   = msg.key?.id        || '';
    const fromMe  = msg.key?.fromMe    || false;
    const ts      = msg.messageTimestamp ? Number(msg.messageTimestamp) : Math.floor(Date.now() / 1000);

    await waEventsQueue.add('messages.upsert', {
      accountId,
      eventType: 'messages.upsert',
      ts,
      meta: { jid, messageId: msgId, fromMe, type },
      payload: msg,
    }, { jobId: `msg_${accountId}_${msgId}` }); // dedup by jobId
  }
}

/**
 * Enqueue a messages.update event (status/receipt changes).
 */
export async function enqueueMessageUpdates(accountId, updates) {
  for (const upd of updates) {
    const msgId = upd.key?.id || '';
    const jid   = upd.key?.remoteJid || '';
    await waEventsQueue.add('messages.update', {
      accountId,
      eventType: 'messages.update',
      ts: Math.floor(Date.now() / 1000),
      meta: { jid, messageId: msgId },
      payload: upd,
    });
  }
}

/**
 * Enqueue a media download + upload job.
 */
export async function enqueueMedia(accountId, messageId, jid, mediaMsg) {
  await waMediaQueue.add('media.upload', {
    accountId, messageId, jid,
    payload: mediaMsg,
  }, { jobId: `media_${accountId}_${messageId}`, attempts: 5 });
}
