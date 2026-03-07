-- Migration 007: Logistics, Inventory, Evidence and Payroll-Ready Core
-- Implements Faze D, E, F: Full cycle for operations management

BEGIN;

-- 1. EVENT MASTER EXTENSIONS
-- Extending the `evenimente` table (if needed, assuming JSON handles most, but we can add structured columns)
ALTER TABLE evenimente
  ADD COLUMN IF NOT EXISTS eventShortId TEXT,
  ADD COLUMN IF NOT EXISTS venue_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS venue_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS client_display_name TEXT,
  ADD COLUMN IF NOT EXISTS required_arrival_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transport_required BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS pickup_from_hq_required BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_summary TEXT;

-- 2. DRIVER / TRIP MODEL EXTENSIONS
ALTER TABLE driver_trips
  ADD COLUMN IF NOT EXISTS driver_user_id UUID REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS vehicle_id TEXT,
  ADD COLUMN IF NOT EXISTS trip_type TEXT CHECK (trip_type IN ('to_hq', 'hq_to_event', 'event_to_hq', 'multi_stop')),
  ADD COLUMN IF NOT EXISTS planned_departure_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_departure_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS planned_arrival_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_arrival_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS route_status TEXT DEFAULT 'planned' CHECK (route_status IN ('planned', 'started', 'late', 'arrived_hq', 'arrived_event', 'completed', 'cancelled')),
  ADD COLUMN IF NOT EXISTS delay_minutes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deviation_score DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS fuel_actual_liters DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS ai_verdict TEXT,
  ADD COLUMN IF NOT EXISTS human_review_status TEXT DEFAULT 'pending' CHECK (human_review_status IN ('pending', 'approved', 'contested', 'rejected'));

-- 3. GPS / GEOFENCE / MOVEMENT MODEL EXTENSIONS
ALTER TABLE employee_movements
  ADD COLUMN IF NOT EXISTS battery_level DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS is_moving BOOLEAN,
  ADD COLUMN IF NOT EXISTS activity_type TEXT,
  ADD COLUMN IF NOT EXISTS heading DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS device_ts TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'gps';

ALTER TABLE geofence_events
  ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES evenimente(id),
  ADD COLUMN IF NOT EXISTS mission_phase TEXT,
  ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS is_late BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS lateness_minutes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trigger_source TEXT DEFAULT 'mobile';

-- 4. RECUZITĂ / INVENTORY / HANDOFF

CREATE TABLE IF NOT EXISTS inventory_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku TEXT UNIQUE,
    name TEXT NOT NULL,
    category TEXT,
    serial_number TEXT,
    unit TEXT DEFAULT 'buc',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_inventory_requirements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES evenimente(id) ON DELETE CASCADE,
    inventory_item_id UUID NOT NULL REFERENCES inventory_items(id),
    required_qty NUMERIC DEFAULT 1,
    role_slot TEXT,
    mandatory BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_handoffs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES evenimente(id),
    trip_id UUID REFERENCES driver_trips(id),
    employee_id UUID REFERENCES employees(id),
    inventory_item_id UUID REFERENCES inventory_items(id),
    qty_out NUMERIC DEFAULT 0,
    qty_returned NUMERIC DEFAULT 0,
    handoff_status TEXT DEFAULT 'planned' CHECK (handoff_status IN ('planned', 'picked_up', 'delivered', 'returned', 'missing', 'damaged')),
    picked_up_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    returned_at TIMESTAMPTZ,
    pickup_proof_asset_id UUID,
    return_proof_asset_id UUID,
    ai_confidence DOUBLE PRECISION,
    human_review_status TEXT DEFAULT 'pending' CHECK (human_review_status IN ('pending', 'approved', 'contested', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. DOVEZI FOTO / VIDEO / ANALIZĂ BATCH

CREATE TABLE IF NOT EXISTS media_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES evenimente(id),
    trip_id UUID REFERENCES driver_trips(id),
    employee_id UUID REFERENCES employees(id),
    source_url TEXT NOT NULL,
    source_type TEXT,
    captured_at TIMESTAMPTZ,
    camera_id TEXT,
    uploaded_by UUID REFERENCES employees(id),
    asset_kind TEXT CHECK (asset_kind IN ('photo', 'video', 'receipt', 'proof')),
    analysis_status TEXT DEFAULT 'pending' CHECK (analysis_status IN ('pending', 'processing', 'completed', 'failed')),
    analysis_summary TEXT,
    analysis_confidence DOUBLE PRECISION,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS media_detections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    detection_type TEXT CHECK (detection_type IN ('person', 'face_match', 'prop', 'receipt')),
    label TEXT,
    confidence DOUBLE PRECISION,
    bbox_json JSONB,
    matched_employee_id UUID REFERENCES employees(id),
    matched_inventory_item_id UUID REFERENCES inventory_items(id),
    frame_ts DOUBLE PRECISION,
    evidence_score DOUBLE PRECISION,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS evidence_bundles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES evenimente(id),
    trip_id UUID REFERENCES driver_trips(id),
    employee_id UUID REFERENCES employees(id),
    bundle_type TEXT CHECK (bundle_type IN ('arrival_proof', 'pickup_proof', 'event_presence', 'return_proof')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'generated', 'reviewed')),
    summary TEXT,
    confidence DOUBLE PRECISION,
    human_review_status TEXT DEFAULT 'pending' CHECK (human_review_status IN ('pending', 'approved', 'contested', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Note: Circular dependencies between inventory_handoffs and media_assets for proof_asset_id
-- To resolve natively, we add the foreign key constraints after table creation.
ALTER TABLE inventory_handoffs
  ADD CONSTRAINT fk_pickup_proof FOREIGN KEY (pickup_proof_asset_id) REFERENCES media_assets(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_return_proof FOREIGN KEY (return_proof_asset_id) REFERENCES media_assets(id) ON DELETE SET NULL;


-- 6. PAYROLL-READY CANDIDATES + HUMAN REVIEW

CREATE TABLE IF NOT EXISTS staff_hours_candidates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id),
    event_id UUID REFERENCES evenimente(id),
    trip_id UUID REFERENCES driver_trips(id),
    candidate_type TEXT CHECK (candidate_type IN ('event_presence', 'transport', 'pickup', 'setup', 'teardown')),
    minutes INTEGER NOT NULL,
    source_bundle_id UUID REFERENCES evidence_bundles(id),
    ai_confidence DOUBLE PRECISION,
    requires_human_approval BOOLEAN DEFAULT true,
    approved_by UUID REFERENCES employees(id),
    approved_at TIMESTAMPTZ,
    review_status TEXT DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'contested', 'rejected')),
    reviewer_comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS & SECURITY (Very basic foundation, allowing authorized app users & AI manager service role)
-- We enable RLS on the new tables.

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_inventory_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_detections ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_hours_candidates ENABLE ROW LEVEL SECURITY;

-- AI Manager service role will bypass RLS or use a secret key. For employees to insert assets:
CREATE POLICY "Allow authenticated full access to logistics tables"
ON inventory_handoffs FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated full access to media assets"
ON media_assets FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated full access to evidence bundles"
ON evidence_bundles FOR ALL TO authenticated USING (true);

COMMIT;
