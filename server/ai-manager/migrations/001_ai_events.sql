-- ============================================================
-- 001_ai_events.sql
-- AI Events table — core event model for AI Manager.
-- Run this in Supabase SQL Editor (or via migration scripts).
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type             text NOT NULL CHECK (source_type IN ('whatsapp','voice','app','gps','image','video')),
  source_id               text,
  conversation_id         text REFERENCES conversations(id) ON DELETE SET NULL,
  call_sid                text,
  client_identity_id      text,
  client_display_name     text,
  event_type              text NOT NULL,
  event_status            text NOT NULL DEFAULT 'proposed'
                            CHECK (event_status IN ('proposed','approved','rejected','contested','needs_review')),
  summary                 text,
  details_json            jsonb,
  ai_confidence           numeric(3,2) CHECK (ai_confidence BETWEEN 0 AND 1),
  ai_suggested_next_action text,
  human_review_status     text NOT NULL DEFAULT 'pending'
                            CHECK (human_review_status IN ('pending','approved','rejected','contested')),
  created_by_ai           boolean NOT NULL DEFAULT true,
  approved_by             text,
  approved_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_events_source_type_idx ON ai_events(source_type);
CREATE INDEX IF NOT EXISTS ai_events_event_status_idx ON ai_events(event_status);
CREATE INDEX IF NOT EXISTS ai_events_human_review_status_idx ON ai_events(human_review_status);
CREATE INDEX IF NOT EXISTS ai_events_conversation_id_idx ON ai_events(conversation_id);
CREATE INDEX IF NOT EXISTS ai_events_created_at_idx ON ai_events(created_at DESC);

COMMENT ON TABLE ai_events IS 'AI-detected and proposed operational events. Human review required before final action.';
COMMENT ON COLUMN ai_events.event_status IS 'proposed=AI suggested, needs_review=requires human attention, approved/rejected/contested=human resolved';
COMMENT ON COLUMN ai_events.ai_confidence IS 'AI confidence score 0.00–1.00';
