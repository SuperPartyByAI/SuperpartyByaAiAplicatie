/**
 * wa-outbox-api.mjs — Outbox HTTP endpoints for WhatsApp server
 * Mount in whatsapp-integration-v6-index.js:
 *   import { registerOutboxRoutes } from './server/whatsapp/workers/wa-outbox-api.mjs';
 *   registerOutboxRoutes(app, supabase, requireAuth, sessionManager);
 *
 * CONTRACT (no ambiguity):
 *   POST /api/wa/outbox/send   — ENQUEUE into outbox_messages (idempotent, durable)
 *   POST /api/wa/send-direct   — SEND NOW via Baileys/session, NO re-enqueue
 *                                 called ONLY by wa-outbox-worker.mjs
 *   GET  /debug/outbox/dlq     — list dead messages
 *   POST /debug/outbox/replay  — re-queue dead message by id
 *   GET  /debug/outbox/stats   — queue depth by status
 */

export function registerOutboxRoutes(app, supabase, requireAuth, sessionManager = null) {

  // ── POST /api/wa/outbox/send ─────────────────────────────────────────────
  // ENQUEUE a WhatsApp outbound message into outbox_messages (idempotent).
  // This does NOT send immediately — wa-outbox-worker picks it up.
  // Body: { accountId, to, type, text?, mediaUrl?, caption?, idempotencyKey? }
  app.post('/api/wa/outbox/send', requireAuth, async (req, res) => {
    try {
      const { accountId, to, type = 'text', idempotencyKey, ...payload } = req.body;
      if (!accountId || !to) {
        return res.status(400).json({ ok: false, error: 'accountId and to are required' });
      }

      // Normalize JID
      const toJid = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;

      // Generate idempotency key if not provided (account:to:timestamp bucket 5min)
      const iKey = idempotencyKey || `${accountId}:${toJid}:${Math.floor(Date.now() / 300000)}`;

      const { data: msgId, error } = await supabase.rpc('enqueue_outbox_message', {
        p_idempotency_key: iKey,
        p_account_id:      accountId,
        p_to_jid:          toJid,
        p_message_type:    type,
        p_payload:         payload,
      });

      if (error) return res.status(500).json({ ok: false, error: error.message });
      if (!msgId) return res.json({ ok: true, dedupe: true, message: 'Message already queued (idempotent)' });

      res.json({ ok: true, messageId: msgId, status: 'queued', note: 'Message enqueued — worker will deliver' });
    } catch (e) {
      console.error('[OutboxAPI] /api/wa/outbox/send error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── POST /api/wa/send-direct ──────────────────────────────────────────────
  // ACTUAL SEND via Baileys session — called ONLY by wa-outbox-worker.
  // NOT an enqueue endpoint. Sends NOW and returns result.
  // Guarded by WA_INTERNAL_TOKEN to prevent unauthorized direct sends.
  //
  // sessionManager must implement:
  //   sendText(accountId, jid, text): Promise
  //   sendMedia(accountId, jid, url, caption, type): Promise
  //
  app.post('/api/wa/send-direct', async (req, res) => {
    // Internal-only token guard
    const authHeader = req.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const internalToken = process.env.WA_INTERNAL_TOKEN;
    if (!internalToken || token !== internalToken) {
      return res.status(403).json({ ok: false, error: 'forbidden: internal endpoint' });
    }

    try {
      const { accountId, to, type = 'text', text, mediaUrl, caption } = req.body;
      if (!accountId || !to) {
        return res.status(400).json({ ok: false, error: 'accountId and to required' });
      }

      // Normalize JID
      const jid = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;

      if (!sessionManager) {
        // Fallback: sessionManager not injected — return error, do not re-enqueue
        return res.status(503).json({ ok: false, error: 'session_manager_not_available — check server mount' });
      }

      let result;
      if (type === 'text') {
        result = await sessionManager.sendText(accountId, jid, text || '');
      } else if (['image', 'video', 'document', 'audio'].includes(type)) {
        result = await sessionManager.sendMedia(accountId, jid, mediaUrl, caption || '', type);
      } else {
        return res.status(400).json({ ok: false, error: `unsupported message type: ${type}` });
      }

      res.json({ ok: true, result });
    } catch (e) {
      console.error('[OutboxAPI] /api/wa/send-direct error:', e.message);
      // Return 5xx so worker applies backoff — do NOT silently drop
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── GET /debug/outbox/stats ───────────────────────────────────────────────
  app.get('/debug/outbox/stats', requireAuth, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('outbox_messages')
        .select('status')
        .then(({ data, error }) => {
          if (error) return { data: null, error };
          const counts = {};
          for (const row of (data || [])) { counts[row.status] = (counts[row.status] || 0) + 1; }
          return { data: counts, error: null };
        });
      if (error) return res.status(500).json({ ok: false, error: error.message });
      res.json({ ok: true, stats: data });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── GET /debug/outbox/dlq ────────────────────────────────────────────────
  app.get('/debug/outbox/dlq', requireAuth, async (req, res) => {
    try {
      const limit = Math.min(Number.parseInt(req.query.limit || '50', 10), 200);
      const { data, error } = await supabase
        .from('outbox_messages')
        .select('id, account_id, to_jid, message_type, status, attempts, error_message, created_at, failed_at')
        .eq('status', 'dead')
        .order('failed_at', { ascending: false })
        .limit(limit);
      if (error) return res.status(500).json({ ok: false, error: error.message });
      res.json({ ok: true, dead: data || [], count: (data || []).length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── POST /debug/outbox/replay ─────────────────────────────────────────────
  // Re-queue a dead message (reset to queued + clear error + reset attempts)
  app.post('/debug/outbox/replay', requireAuth, async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ ok: false, error: 'id required' });
      const { data, error } = await supabase
        .from('outbox_messages')
        .update({
          status: 'queued',
          attempts: 0,
          error_message: null,
          next_retry_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('status', 'dead')   // safety: only replay dead
        .select('id, status');
      if (error) return res.status(500).json({ ok: false, error: error.message });
      if (!data || data.length === 0) return res.status(404).json({ ok: false, error: 'Message not found or not in dead status' });
      res.json({ ok: true, replayed: data[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}
