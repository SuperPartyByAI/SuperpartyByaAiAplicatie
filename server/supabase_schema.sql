-- ============================================================
-- SUPERPARTY - SUPABASE SCHEMA
-- Migrated from Firebase Firestore
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- CONVERSATIONS (WhatsApp threads)
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,                    -- firestore doc id (jid@s.whatsapp.net)
  jid TEXT,                               -- WhatsApp JID
  name TEXT,
  phone TEXT,
  account_id TEXT,                        -- wa_accounts reference
  account_label TEXT,
  client_id TEXT,
  last_message_at BIGINT,                 -- unix timestamp seconds
  last_message_preview TEXT,
  photo_url TEXT,
  assigned_employee_id TEXT,
  assigned_employee_name TEXT,
  unread_count INT DEFAULT 0,
  is_group BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MESSAGES (subcollection of conversations)
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,                    -- message id from WhatsApp
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  text TEXT DEFAULT '',
  type TEXT DEFAULT 'chat',               -- chat, image, audio, video, document, etc.
  from_me BOOLEAN DEFAULT false,
  push_name TEXT,
  timestamp BIGINT,                       -- unix timestamp seconds
  media_url TEXT,
  mimetype TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);

-- ============================================================
-- WA_ACCOUNTS (WhatsApp connected accounts)
-- ============================================================
CREATE TABLE IF NOT EXISTS wa_accounts (
  id TEXT PRIMARY KEY,
  label TEXT,
  phone_number TEXT,
  state TEXT DEFAULT 'disconnected',      -- connected, disconnected, connecting
  ping_ms INT DEFAULT 0,
  messages_in INT DEFAULT 0,
  messages_out INT DEFAULT 0,
  recent_logs JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- EMPLOYEES (staff profiles)
-- ============================================================
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,                    -- firebase UID
  email TEXT UNIQUE,
  name TEXT,
  role TEXT DEFAULT 'staff',             -- admin, staff
  phone TEXT,
  status TEXT DEFAULT 'active',          -- active, suspended
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- APP_INBOX (notifications/announcements)
-- ============================================================
CREATE TABLE IF NOT EXISTS app_inbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT DEFAULT 'announcement',       -- announcement, whatsapp, system
  source TEXT DEFAULT 'system',
  read_by TEXT[] DEFAULT '{}',           -- array of employee IDs
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CALLS (voice call logs)
-- ============================================================
CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  from_number TEXT,
  to_number TEXT,
  direction TEXT,                         -- inbound, outbound
  status TEXT,
  duration_seconds INT DEFAULT 0,
  recording_url TEXT,
  assigned_employee_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read/write conversations
CREATE POLICY "authenticated_read_conversations" ON conversations
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "service_role_all_conversations" ON conversations
  FOR ALL USING (auth.role() = 'service_role');

-- Allow authenticated users to read messages
CREATE POLICY "authenticated_read_messages" ON messages
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "service_role_all_messages" ON messages
  FOR ALL USING (auth.role() = 'service_role');

-- wa_accounts - authenticated read
CREATE POLICY "authenticated_read_wa_accounts" ON wa_accounts
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "service_role_all_wa_accounts" ON wa_accounts
  FOR ALL USING (auth.role() = 'service_role');

-- employees - authenticated read
CREATE POLICY "authenticated_read_employees" ON employees
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "service_role_all_employees" ON employees
  FOR ALL USING (auth.role() = 'service_role');

-- app_inbox - authenticated read
CREATE POLICY "authenticated_read_app_inbox" ON app_inbox
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "service_role_all_app_inbox" ON app_inbox
  FOR ALL USING (auth.role() = 'service_role');

-- calls - authenticated read
CREATE POLICY "authenticated_read_calls" ON calls
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "service_role_all_calls" ON calls
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- REALTIME (enable for live updates in Flutter)
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE app_inbox;
