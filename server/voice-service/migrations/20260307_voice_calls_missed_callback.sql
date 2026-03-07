-- Migration: voice_calls missed-call tracking fields
-- Apply in Supabase SQL Editor for both PROD and CI projects
-- Idempotent: uses ADD COLUMN IF NOT EXISTS

ALTER TABLE public.voice_calls
  ADD COLUMN IF NOT EXISTS missed_callback_needed      BOOLEAN   DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS missed_callback_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS missed_callback_resolved_by UUID;

-- Index for fast lookup of pending missed calls
CREATE INDEX IF NOT EXISTS voice_calls_missed_idx
  ON public.voice_calls (missed_callback_needed, started_at DESC)
  WHERE missed_callback_needed = TRUE;

-- Helper function for identity resolve rate (used by Prometheus gauge)
CREATE OR REPLACE FUNCTION public.voice_identity_resolve_rate()
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN COUNT(*) = 0 THEN NULL
    ELSE ROUND(COUNT(client_identity_id)::numeric / COUNT(*)::numeric, 4)
  END
  FROM public.voice_calls
  WHERE created_at > NOW() - INTERVAL '24 hours';
$$;
