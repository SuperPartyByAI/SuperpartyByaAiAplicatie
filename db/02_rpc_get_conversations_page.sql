-- 02_rpc_get_conversations_page.sql  (v4 — PII isolation: no phone_e164 in agent payload)
create index if not exists idx_conversations_last_message_at on public.conversations (last_message_at desc);
create index if not exists idx_conversations_identity_id on public.conversations (identity_id) where identity_id is not null;

drop function if exists public.get_conversations_page(integer, integer);

create or replace function public.get_conversations_page(p_page integer, p_page_size integer)
returns table(
  id                        text,
  name                      text,
  jid                       text,
  client_id                 uuid,
  account_label             text,
  photo_url                 text,
  last_message_at           timestamptz,
  last_message_preview      text,
  assigned_employee_id      text,
  client_display_name       text,
  identity_resolution_status text,
  wa_primary_jid            text,
  identity_id               uuid
)
language plpgsql
security definer
as $$
declare
  page_size int := least(coalesce(p_page_size, 50), 100);
  v_offset  int := greatest((coalesce(p_page, 0) * page_size), 0);
begin
  return query
  select
    c.id::text,
    c.name::text,
    c.jid::text,
    -- Safe UUID cast: skip legacy non-UUID values (e.g. "Dovada plăti")
    (case when c.client_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then c.client_id::uuid else null end) as client_id,
    c.account_label::text,
    c.photo_url::text,
    -- Native timestamptz — avoids type mismatch with conversations_public view
    c.last_message_at::timestamptz,
    c.last_message_preview::text,
    c.assigned_employee_id::text,
    -- Resolved display name: identity > conversation display_name > name (NO phone_e164 fallback)
    coalesce(
      nullif(trim(coalesce(i.display_name, '')), ''),
      nullif(trim(coalesce(c.client_display_name, '')), ''),
      nullif(trim(coalesce(c.name, '')), '')
    )::text as client_display_name,
    i.resolution_status::text as identity_resolution_status,
    i.wa_primary_jid::text,
    i.id as identity_id
  from public.conversations_public c
  left join public.wa_client_identities i on c.identity_id = i.id
  order by c.last_message_at desc nulls last
  limit page_size offset v_offset;
end;
$$;
