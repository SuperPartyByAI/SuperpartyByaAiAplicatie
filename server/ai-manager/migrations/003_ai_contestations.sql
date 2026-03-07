-- ============================================================
-- 003_ai_contestations.sql
-- Contestation / Human Review workflow.
-- AI proposes → human can contest → manager decides.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_contestations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES ai_events(id) ON DELETE CASCADE,
  ai_verdict      text NOT NULL,
  ai_confidence   numeric(3,2) CHECK (ai_confidence BETWEEN 0 AND 1),
  evidence_bundle jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'proposed'
                    CHECK (status IN ('proposed','approved','rejected','contested')),
  human_comment   text,
  final_decision  text,
  decided_by      text,
  decided_at      timestamptz,
  audit_trail     jsonb NOT NULL DEFAULT '[]',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_contestations_event_id_idx ON ai_contestations(event_id);
CREATE INDEX IF NOT EXISTS ai_contestations_status_idx ON ai_contestations(status);
CREATE INDEX IF NOT EXISTS ai_contestations_created_at_idx ON ai_contestations(created_at DESC);

COMMENT ON TABLE ai_contestations IS 'Human review + contestation system. AI proposes a verdict; employees can contest; manager approves final decision.';
COMMENT ON COLUMN ai_contestations.audit_trail IS 'JSON array of all state transitions: [{action, by, at, note}]';
COMMENT ON COLUMN ai_contestations.evidence_bundle IS 'JSON bundle with links, screenshots, GPS data, etc.';
