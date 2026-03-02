-- Migration script to add missing columns to wa_accounts and add to realtime publication
ALTER TABLE public.wa_accounts
ADD COLUMN IF NOT EXISTS qr_code TEXT NULL,
ADD COLUMN IF NOT EXISTS requires_qr BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS needs_qr_since TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS last_ping_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL;

-- Enable Realtime for wa_accounts if not already added
BEGIN;
  -- Remove from publication first to avoid errors if already present, but that fails if it's not.
  -- Alternatively, just try to add it. Since we can't easily do IF NOT EXISTS for publications without plpgsql, we just do:
  ALTER PUBLICATION supabase_realtime ADD TABLE wa_accounts;
EXCEPTION
  WHEN undefined_object THEN
    RAISE NOTICE 'Publication supabase_realtime does not exist';
  WHEN duplicate_object THEN
    RAISE NOTICE 'Table wa_accounts is already in publication supabase_realtime';
END;
