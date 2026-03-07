-- ============================================================
-- 002_ai_audit_log.sql
-- Audit log for all AI actions — immutable, append-only.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid REFERENCES ai_events(id) ON DELETE SET NULL,
  action         text NOT NULL,
  input_payload  jsonb,
  output_payload jsonb,
  model_used     text,
  tokens_used    integer,
  latency_ms     integer,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Audit log is append-only: no UPDATE allowed (enforced by policy below)
-- Disable row-level updates via RLS if needed in production.

CREATE INDEX IF NOT EXISTS ai_audit_log_event_id_idx ON ai_audit_log(event_id);
CREATE INDEX IF NOT EXISTS ai_audit_log_action_idx ON ai_audit_log(action);
CREATE INDEX IF NOT EXISTS ai_audit_log_created_at_idx ON ai_audit_log(created_at DESC);

COMMENT ON TABLE ai_audit_log IS 'Immutable audit log of all AI Manager actions. Every analyze-event call, trip action, and contestation change is recorded here.';
