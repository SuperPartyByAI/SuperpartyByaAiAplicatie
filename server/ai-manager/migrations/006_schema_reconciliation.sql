/**
 * 006_schema_reconciliation.sql
 * Reconciles the manual schema patches applied to support the local-first AI Manager endpoints.
 * This migration ensures the codebase is the single source of truth for the DB schema.
 */

-- 1. driver_trips: make start_lat, start_lng nullable and add missing columns
ALTER TABLE public.driver_trips 
  ALTER COLUMN start_lat DROP NOT NULL,
  ALTER COLUMN start_lng DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS event_id TEXT,
  ADD COLUMN IF NOT EXISTS planned_route JSONB,
  ADD COLUMN IF NOT EXISTS actual_route JSONB DEFAULT '{"points": []}',
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS km_actual FLOAT,
  ADD COLUMN IF NOT EXISTS fuel_estimate_liters FLOAT,
  ADD COLUMN IF NOT EXISTS end_lat FLOAT,
  ADD COLUMN IF NOT EXISTS end_lng FLOAT;

-- 2. geofence_events: add missing columns
ALTER TABLE public.geofence_events
  ADD COLUMN IF NOT EXISTS trip_id UUID REFERENCES public.driver_trips(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS geofence_type TEXT,
  ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS ai_decision TEXT;

-- 3. employee_movements: rename accuracy_m and speed_kmh
ALTER TABLE public.employee_movements
  ADD COLUMN IF NOT EXISTS accuracy_meters FLOAT,
  ADD COLUMN IF NOT EXISTS speed_kmh FLOAT,
  ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ DEFAULT NOW();

-- 4. ai_contestations: update status check and add missing columns
ALTER TABLE public.ai_contestations 
  DROP CONSTRAINT IF EXISTS ai_contestations_status_check;

ALTER TABLE public.ai_contestations
  ADD COLUMN IF NOT EXISTS audit_trail JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS evidence_bundle JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS disputed_field TEXT,
  ADD COLUMN IF NOT EXISTS reviewer_notes TEXT,
  ADD COLUMN IF NOT EXISTS ai_verdict TEXT,
  ADD COLUMN IF NOT EXISTS human_comment TEXT,
  ADD COLUMN IF NOT EXISTS final_decision TEXT,
  ADD COLUMN IF NOT EXISTS decided_by TEXT,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

ALTER TABLE public.ai_contestations
  ADD CONSTRAINT ai_contestations_status_check 
  CHECK (status IN ('open', 'under_review', 'resolved', 'dismissed', 'pending', 'escalated', 'proposed', 'approved', 'rejected', 'contested'));

-- 5. media_assets: add missing columns and rename owner_employee_id
ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS camera_label TEXT,
  ADD COLUMN IF NOT EXISTS duration_seconds FLOAT,
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS event_id UUID;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media_assets' AND column_name='employee_id') THEN
    ALTER TABLE public.media_assets RENAME COLUMN employee_id TO owner_employee_id;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media_assets' AND column_name='owner_employee_id') THEN
    ALTER TABLE public.media_assets ADD COLUMN owner_employee_id TEXT;
  END IF;
END $$;

-- 6. analysis_jobs: rename asset_id to media_asset_id if needed
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analysis_jobs' AND column_name='asset_id') THEN
    ALTER TABLE public.analysis_jobs RENAME COLUMN asset_id TO media_asset_id;
  END IF;
END $$;

ALTER TABLE public.analysis_jobs
  ADD COLUMN IF NOT EXISTS media_asset_id UUID;
