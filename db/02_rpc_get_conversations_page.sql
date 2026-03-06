-- 02_rpc_get_conversations_page.sql  (v2 — includes identity fields)
-- Ensure index on last_message_at for fast ordering
create index if not exists idx_conversations_last_message_at on public.conversations (last_message_at desc);
create index if not exists idx_conversations_identity_id on public.conversations (identity_id) where identity_id is not null;

-- RPC to fetch paginated conversations with enforced max page_size
drop function if exists public.get_conversations_page(integer, integer);

create or replace function public.get_conversations_page(p_page integer, p_page_size integer)
returns table(
  id                        text,
  name                      text,
  jid                       text,
  client_id                 uuid,
  account_label             text,
  photo_url                 text,
  last_message_at           bigint,
  last_message_preview      text,
  assigned_employee_id      text,
  client_display_name       text,
  phone_e164                text,
  identity_resolution_status text,
  wa_primary_jid            text
)
language plpgsql
security definer
as $$
declare
  page_size int := least(coalesce(p_page_size,50), 100); -- max 100 enforced
  v_offset  int := greatest((coalesce(p_page,0) * page_size), 0);
begin
  return query
  select
    c.id::text,
    c.name::text,
    c.jid::text,
    c.client_id::uuid,
    c.account_label::text,
    c.photo_url::text,
    c.last_message_at::bigint,
    c.last_message_preview::text,
    c.assigned_employee_id::text,
    -- Resolved name: canonical identity > conversations.client_display_name > conversations.name
    coalesce(
      nullif(trim(i.display_name), ''),
      nullif(trim(c.client_display_name), ''),
      nullif(trim(c.name), '')
    )::text as client_display_name,
    i.phone_e164::text,
    i.resolution_status::text as identity_resolution_status,
    i.wa_primary_jid::text
  from public.conversations_public c
  left join public.wa_client_identities i on c.identity_id = i.id
  order by c.last_message_at desc nulls last
  limit page_size offset v_offset;
end;
$$;
