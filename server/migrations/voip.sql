CREATE TABLE IF NOT EXISTS processed_webhooks (
  id serial PRIMARY KEY,
  sid text UNIQUE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calls (
  id text PRIMARY KEY,
  from_number text,
  to_number text,
  status text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id serial PRIMARY KEY,
  device_identity text UNIQUE,
  device_token text,
  platform text,
  push_credential_sid text,
  device_number text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
