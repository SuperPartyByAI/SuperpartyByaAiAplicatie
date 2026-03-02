-- 02_rpc_get_conversations_page.sql
-- Ensure index on last_message_at for fast ordering
create index if not exists idx_conversations_last_message_at on public.conversations (last_message_at desc);

-- RPC to fetch paginated conversations with enforced max page_size
create or replace function public.get_conversations_page(p_page integer, p_page_size integer)
returns table(
  id text,
  name text,
  jid text,
  client_id uuid,
  account_label text,
  photo_url text,
  last_message_at timestamptz,
  last_message_preview text,
  assigned_employee_id text
)
language plpgsql
security definer
as $$
declare
  page_size int := least(coalesce(p_page_size,50), 100); -- max 100 enforced
  v_offset int := greatest((coalesce(p_page,0) * page_size), 0);
begin
  return query
  select
    c.id::text, c.name::text, c.jid::text as jid, c.client_id::uuid, c.account_label::text, c.photo_url::text,
    c.last_message_at::timestamptz, c.last_message_preview::text, c.assigned_employee_id::text
  from public.conversations c
  order by c.last_message_at desc nulls last
  limit page_size offset v_offset;
end;
$$;
