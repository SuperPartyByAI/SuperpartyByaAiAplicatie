-- ============================================================
-- 002_wa_client_identity.sql
-- WhatsApp canonical client identity subsystem
-- Apply manually in Supabase SQL Editor
-- Safe to re-run (all IF NOT EXISTS / CREATE OR REPLACE)
-- Date: 2026-03-06
-- ============================================================

-- ── 1. Canonical identity table ─────────────────────────────
create table if not exists public.wa_client_identities (
  id                    uuid          primary key default gen_random_uuid(),
  account_id            text          not null references public.wa_accounts(id) on delete cascade,
  phone_e164            text          null,           -- null for @lid JIDs
  display_name          text          null,           -- best available name
  display_name_source   text          not null default 'inferred',  -- pushName|phonebook|manual|inferred
  wa_primary_jid        text          null,           -- canonical @s.whatsapp.net JID if known
  resolution_status     text          not null default 'unresolved',  -- resolved|partial|unresolved
  first_seen_at         timestamptz   not null default now(),
  last_seen_at          timestamptz   not null default now(),
  last_resolved_at      timestamptz   null,
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now()
);

comment on table public.wa_client_identities is
  'Canonical identity per WhatsApp client. Source of truth for name and phone, independent of conversations.';

comment on column public.wa_client_identities.resolution_status is
  'resolved = phone_e164 known; partial = @lid alias only; unresolved = no usable identifier';

-- Unique: one identity per (account, normalized phone)
create unique index if not exists idx_wa_client_identities_account_phone
  on public.wa_client_identities (account_id, phone_e164)
  where phone_e164 is not null;

create index if not exists idx_wa_client_identities_account
  on public.wa_client_identities (account_id);

create index if not exists idx_wa_client_identities_resolution
  on public.wa_client_identities (resolution_status);

-- ── 2. JID alias table ───────────────────────────────────────
create table if not exists public.wa_jid_aliases (
  jid           text          not null,
  account_id    text          not null references public.wa_accounts(id) on delete cascade,
  identity_id   uuid          not null references public.wa_client_identities(id) on delete cascade,
  jid_type      text          not null default 'unknown',  -- s.whatsapp.net|lid|group|broadcast|unknown
  phone_e164    text          null,    -- extracted from JID if @s.whatsapp.net
  first_seen_at timestamptz   not null default now(),
  last_seen_at  timestamptz   not null default now(),
  primary key (jid, account_id)
);

comment on table public.wa_jid_aliases is
  'All JID aliases (including @lid) mapped to a canonical wa_client_identities row.';

create index if not exists idx_wa_jid_aliases_identity
  on public.wa_jid_aliases (identity_id);

create index if not exists idx_wa_jid_aliases_account
  on public.wa_jid_aliases (account_id);

-- ── 3. Link conversations to identity ───────────────────────
alter table public.conversations
  add column if not exists identity_id uuid references public.wa_client_identities(id) on delete set null;

create index if not exists idx_conversations_identity_id
  on public.conversations (identity_id)
  where identity_id is not null;

-- ── 4. Add phone column to conversations if missing ─────────
alter table public.conversations
  add column if not exists phone text null;

comment on column public.conversations.phone is
  'Denormalized phone_e164 from client identity, for fast UI access without JOIN.';

-- ── 5. Verify ────────────────────────────────────────────────
select
  t.table_name,
  count(c.column_name) as col_count
from information_schema.tables t
join information_schema.columns c on t.table_name = c.table_name
where t.table_schema = 'public'
  and t.table_name in ('wa_client_identities', 'wa_jid_aliases')
group by t.table_name;
-- Expected: 2 rows (wa_client_identities ~16 cols, wa_jid_aliases ~7 cols)
