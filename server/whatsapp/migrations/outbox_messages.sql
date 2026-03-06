-- ============================================================
-- outbox_messages — WhatsApp Durable Outbox Schema
-- Apply to Supabase / Postgres
-- ============================================================

CREATE TABLE IF NOT EXISTS outbox_messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT        UNIQUE NOT NULL,          -- client-provided dedup key
  account_id      TEXT        NOT NULL,                 -- WhatsApp account (wa_accounts.id)
  to_jid          TEXT        NOT NULL,                 -- recipient JID (e164@s.whatsapp.net)
  message_type    TEXT        NOT NULL DEFAULT 'text',  -- text | image | document | template
  payload         JSONB       NOT NULL,                 -- {text, mediaUrl, caption, templateName, ...}
  status          TEXT        NOT NULL DEFAULT 'queued' -- queued | sending | sent | failed | dead
    CHECK (status IN ('queued','sending','sent','failed','dead')),
  attempts        INT         NOT NULL DEFAULT 0,
  max_attempts    INT         NOT NULL DEFAULT 5,
  next_retry_at   TIMESTAMPTZ NOT NULL DEFAULT now(),   -- earliest eligible for processing
  sent_at         TIMESTAMPTZ,
  failed_at       TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for worker queries
CREATE INDEX IF NOT EXISTS outbox_messages_status_idx
  ON outbox_messages (status, next_retry_at)
  WHERE status IN ('queued','failed');

CREATE INDEX IF NOT EXISTS outbox_messages_account_status_idx
  ON outbox_messages (account_id, status);

CREATE INDEX IF NOT EXISTS outbox_messages_idempotency_idx
  ON outbox_messages (idempotency_key);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_outbox_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS outbox_updated_at_trigger ON outbox_messages;
CREATE TRIGGER outbox_updated_at_trigger
  BEFORE UPDATE ON outbox_messages
  FOR EACH ROW EXECUTE FUNCTION update_outbox_updated_at();

-- RPC: enqueue a message (idempotent)
CREATE OR REPLACE FUNCTION enqueue_outbox_message(
  p_idempotency_key TEXT,
  p_account_id      TEXT,
  p_to_jid          TEXT,
  p_message_type    TEXT,
  p_payload         JSONB
)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO outbox_messages (idempotency_key, account_id, to_jid, message_type, payload)
  VALUES (p_idempotency_key, p_account_id, p_to_jid, p_message_type, p_payload)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;  -- NULL if already existed (idempotent)
END;
$$;

-- RPC: claim next batch for processing (atomic, prevents double-processing)
CREATE OR REPLACE FUNCTION claim_outbox_batch(
  p_account_id TEXT,
  p_batch_size INT DEFAULT 5
)
RETURNS SETOF outbox_messages LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
    UPDATE outbox_messages
    SET status = 'sending',
        attempts = attempts + 1,
        updated_at = now()
    WHERE id IN (
      SELECT id FROM outbox_messages
      WHERE account_id  = p_account_id
        AND status IN ('queued', 'failed')
        AND next_retry_at <= now()
        AND attempts < max_attempts
      ORDER BY next_retry_at ASC
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED   -- concurrent safe
    )
    RETURNING *;
END;
$$;

COMMENT ON TABLE outbox_messages IS 'Durable outbound WhatsApp message queue with retry, DLQ, idempotency';
COMMENT ON COLUMN outbox_messages.status IS 'queued=waiting | sending=claimed by worker | sent=delivered | failed=will retry | dead=max attempts exhausted';
COMMENT ON COLUMN outbox_messages.idempotency_key IS 'Client dedup key — format: accountId:toJid:clientMsgId';
