-- ============================================================
-- 005_media_jobs.sql
-- Video / Image Batch Analysis foundation.
-- Assets saved to Google Drive / storage; AI processes in batch.
-- ============================================================

CREATE TABLE IF NOT EXISTS media_assets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_employee_id   text REFERENCES employees(id) ON DELETE SET NULL,
  event_id            uuid REFERENCES ai_events(id) ON DELETE SET NULL,
  source_type         text CHECK (source_type IN ('google_drive','upload','camera','whatsapp','unknown')),
  source_url          text NOT NULL,
  camera_label        text,
  captured_at         timestamptz,
  analysis_status     text NOT NULL DEFAULT 'pending'
                        CHECK (analysis_status IN ('pending','queued','processing','done','failed')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_assets_event_id_idx ON media_assets(event_id);
CREATE INDEX IF NOT EXISTS media_assets_employee_id_idx ON media_assets(owner_employee_id);
CREATE INDEX IF NOT EXISTS media_assets_status_idx ON media_assets(analysis_status);
CREATE INDEX IF NOT EXISTS media_assets_created_at_idx ON media_assets(created_at DESC);

CREATE TABLE IF NOT EXISTS analysis_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_asset_id   uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','running','done','failed')),
  job_type         text NOT NULL CHECK (job_type IN ('image_analysis','video_analysis')),
  result_json      jsonb,           -- structured output from Vision AI
  confidence       numeric(3,2) CHECK (confidence BETWEEN 0 AND 1),
  evidence_tags    jsonb,           -- array of detected tags/labels
  error            text,
  started_at       timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analysis_jobs_asset_id_idx ON analysis_jobs(media_asset_id);
CREATE INDEX IF NOT EXISTS analysis_jobs_status_idx ON analysis_jobs(status);
CREATE INDEX IF NOT EXISTS analysis_jobs_created_at_idx ON analysis_jobs(created_at DESC);

COMMENT ON TABLE media_assets IS 'Media assets (images/videos) linked to events or employees. Stored in Google Drive or cloud storage.';
COMMENT ON TABLE analysis_jobs IS 'Batch analysis jobs processed asynchronously by AI Manager. Phase 2: integrate Google Vision / OpenAI Vision.';
