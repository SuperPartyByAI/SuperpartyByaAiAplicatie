-- ============================================================
-- 004_gps_trips.sql
-- GPS / Employee Movement tracking for AI Employee Manager.
-- Always-on background tracking for drivers/collaborators.
-- ============================================================

CREATE TABLE IF NOT EXISTS driver_trips (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      text REFERENCES employees(id) ON DELETE SET NULL,
  event_id         uuid REFERENCES ai_events(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','completed','cancelled')),
  planned_route    jsonb,           -- AI-proposed route: { waypoints: [{lat,lng,label}] }
  actual_route     jsonb,           -- Recorded: { points: [{lat,lng,ts}] }
  km_estimate      numeric(8,2),
  km_actual        numeric(8,2),
  fuel_estimate_liters numeric(6,2),
  started_at       timestamptz,
  ended_at         timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_trips_employee_id_idx ON driver_trips(employee_id);
CREATE INDEX IF NOT EXISTS driver_trips_status_idx ON driver_trips(status);
CREATE INDEX IF NOT EXISTS driver_trips_event_id_idx ON driver_trips(event_id);
CREATE INDEX IF NOT EXISTS driver_trips_started_at_idx ON driver_trips(started_at DESC);

-- Employee location points (high-frequency, buffered from mobile)
CREATE TABLE IF NOT EXISTS employee_movements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      text REFERENCES employees(id) ON DELETE CASCADE,
  trip_id          uuid REFERENCES driver_trips(id) ON DELETE CASCADE,
  lat              numeric(10,7) NOT NULL,
  lng              numeric(10,7) NOT NULL,
  accuracy_meters  numeric(6,2),
  speed_kmh        numeric(5,2),
  recorded_at      timestamptz NOT NULL,
  synced_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_movements_trip_id_idx ON employee_movements(trip_id);
CREATE INDEX IF NOT EXISTS employee_movements_employee_id_idx ON employee_movements(employee_id);
CREATE INDEX IF NOT EXISTS employee_movements_recorded_at_idx ON employee_movements(recorded_at DESC);

-- Geofence events: sediu, eveniment location, custom zones
CREATE TABLE IF NOT EXISTS geofence_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    text REFERENCES employees(id) ON DELETE CASCADE,
  trip_id        uuid REFERENCES driver_trips(id) ON DELETE SET NULL,
  geofence_id    text NOT NULL,    -- e.g. 'sediu', 'event:uuid', 'custom:label'
  geofence_type  text NOT NULL CHECK (geofence_type IN ('enter','exit','dwell')),
  lat            numeric(10,7),
  lng            numeric(10,7),
  recorded_at    timestamptz NOT NULL,
  ai_decision    text,             -- AI evaluation of this geofence event
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS geofence_events_employee_id_idx ON geofence_events(employee_id);
CREATE INDEX IF NOT EXISTS geofence_events_trip_id_idx ON geofence_events(trip_id);
CREATE INDEX IF NOT EXISTS geofence_events_recorded_at_idx ON geofence_events(recorded_at DESC);

COMMENT ON TABLE driver_trips IS 'GPS trip records: planned vs actual routes, km, fuel. AI compares planned vs real for compliance checks.';
COMMENT ON TABLE employee_movements IS 'High-frequency location points buffered from mobile app (always-on background GPS).';
COMMENT ON TABLE geofence_events IS 'Entries/exits from significant locations: HQ, event venue, custom zones. Basis for AI lateness detection.';
