-- WhatsApp DB Migrations (applied to Supabase project: ilkphpidhuytucxlglqi)
-- Date: 2026-03-06
-- Applied via Supabase SQL Editor (not via migration tool — apply manually)

-- ─── Migration 001: conversations.last_synced_at ─────────────────────────────
-- Allows incremental sync; only fetch messages newer than this timestamp.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN conversations.last_synced_at IS
  'Last time this conversation was synced from WhatsApp. Used for incremental delta sync.';

-- ─── Migration 002: messages unique constraint (idempotency) ─────────────────
-- Prevents duplicate rows when Baileys replays messages after reconnect.
-- NOTE: Drop old partial index if it exists before adding constraint.
DROP INDEX IF EXISTS messages_account_message_unique;

ALTER TABLE messages
  ADD CONSTRAINT messages_account_message_unique
  UNIQUE (account_id, message_id);

COMMENT ON CONSTRAINT messages_account_message_unique ON messages IS
  'Idempotency constraint: prevents duplicate messages from Baileys history sync or reconnect replays.';

-- ─── Verify ──────────────────────────────────────────────────────────────────
SELECT
  conname AS constraint_name,
  contype AS type
FROM pg_constraint
WHERE conrelid = 'messages'::regclass
  AND conname = 'messages_account_message_unique';
-- Expected: 1 row with type='u' (unique)
