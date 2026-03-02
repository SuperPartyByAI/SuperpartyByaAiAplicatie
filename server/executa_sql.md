## Rulează codul de mai jos direct în Supabase SQL Editor

Conectarea `pg` necesită parola bazei de date (DATABASE_URL / postgres://...). Cum ea nu este expusă în codul sursă descărcat de mine și API-ul REST refuză execuții complexe (CREATE VIEW), te rog **copiază și rulează manual în Supabase > SQL Editor** acest bloc:

```sql
-- 1. Creez view-ul pentru clienți + interfața conversațiilor
CREATE OR REPLACE VIEW public.conversations_public AS
SELECT
  c.id,
  c.name,
  c.canonical_jid as jid,
  c.client_id,
  c.account_label,
  c.photo_url,
  c.last_message_at,
  c.last_message_preview,
  c.assigned_employee_id,
  COALESCE(c.name, cl.display_name) as client_display_name
FROM public.conversations c
LEFT JOIN public.clients cl ON cl.id = c.client_id;

GRANT SELECT ON public.conversations_public TO authenticated;

-- 2. Înlocuiesc funcția curentă ca lista din Flutter să o ia corect
create index if not exists idx_conversations_last_message_at on public.conversations (last_message_at desc);

drop function if exists public.get_conversations_page(integer, integer);

create or replace function public.get_conversations_page(p_page integer, p_page_size integer)
returns table(
  id text,
  name text,
  jid text,
  client_id uuid,
  account_label text,
  photo_url text,
  last_message_at bigint,
  last_message_preview text,
  assigned_employee_id text,
  client_display_name text
)
language plpgsql
security definer
as $$
declare
  page_size int := least(coalesce(p_page_size,50), 100);
  v_offset int := greatest((coalesce(p_page,0) * page_size), 0);
begin
  return query
  select
    c.id::text, c.name::text, c.jid::text as jid, c.client_id::uuid, c.account_label::text, c.photo_url::text,
    c.last_message_at::bigint, c.last_message_preview::text, c.assigned_employee_id::text, c.client_display_name::text
  from public.conversations_public c
  order by c.last_message_at desc nulls last
  limit page_size offset v_offset;
end;
$$;
```
