const { Client } = require('pg');

async function run() {
    const config = {
        host: 'db.ilkphpidhuytucxlglqi.supabase.co',
        port: 5432,
        user: 'postgres',
        password: 'Andrei209521!',
        database: 'postgres',
        ssl: { rejectUnauthorized: false }
    };
    
    console.log("Connecting via IPv6 to " + config.host);
    const client = new Client(config);
    try {
        await client.connect();

        const sql = String.raw`
-- BACKUP (salvează numele originale)
drop table if exists public.clients_display_name_backup;
create table public.clients_display_name_backup (
  id text primary key,
  display_name text,
  backed_at timestamptz default now()
);

insert into public.clients_display_name_backup (id, display_name)
select id::text, display_name
from public.clients c
where not exists (select 1 from public.clients_display_name_backup b where b.id = c.id::text);

-- Index
create index if not exists idx_messages_conversation_created_at on public.messages(conversation_id, created_at);

-- Ordine după prima apariţie a unui mesaj
drop table if exists tmp_client_order;
create table tmp_client_order as
select
  cl.id::text as client_id,
  row_number() over (
    order by coalesce(min(m.created_at), '9999-12-31'::timestamptz) asc, cl.created_at asc, cl.id::text asc
  ) as rn
from public.clients cl
left join public.conversations c on c.client_id::text = cl.id::text
left join public.messages m on m.conversation_id::text = c.id::text
group by cl.id;

-- Suprascrie display_name la Client N pentru TOTI
update public.clients p
set display_name = 'Client ' || o.rn
from tmp_client_order o
where p.id::text = o.client_id;
drop table tmp_client_order;

-- sequence pentru viitor 
DO $$
DECLARE
  v_maxn int;
BEGIN
  select coalesce(max( (regexp_replace(display_name,'^Client\s+','')::int) ),0) into v_maxn
  from public.clients
  where display_name ~ '^Client\s*[0-9]+$';
  
  IF (select count(*) from pg_class where relkind='S' and relname='clients_number_seq') = 0 THEN
    EXECUTE 'create sequence clients_number_seq start ' || (v_maxn + 1);
  ELSE
    PERFORM setval('clients_number_seq', v_maxn + 1, false);
  END IF;
END $$;

-- Trigger function + trigger
create or replace function public.assign_client_name_on_insert()
returns trigger language plpgsql security definer as $$
declare v_name text; begin
  if new.display_name is null or trim(new.display_name) = '' then
    v_name := 'Client ' || nextval('clients_number_seq');
    new.display_name := v_name;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_assign_client_name on public.clients;
create trigger trg_assign_client_name before insert on public.clients
for each row execute procedure public.assign_client_name_on_insert();

-- View (fără phone)
drop view if exists public.conversations_public cascade;

create view public.conversations_public as
select
  c.id,
  cl.display_name as client_display_name,
  c.jid as jid,
  c.client_id,
  c.account_label,
  c.photo_url,
  c.last_message_at,
  c.last_message_preview,
  c.assigned_employee_id
from public.conversations c
left join public.clients cl on cl.id::text = c.client_id::text;

grant select on public.conversations_public to authenticated;

-- RPC get_conversation (security definer)
drop function if exists public.get_conversation(uuid);
drop function if exists public.get_conversation(text);

create or replace function public.get_conversation(p_conv_id text)
returns table (
  id text, name text, jid text, client_id text, client_display_name text, phone text, photo_url text, last_message_preview text, last_message_at timestamptz
) language plpgsql security definer as $$
declare
  caller_email text := current_setting('request.jwt.claims.email', true);
begin
  return query
  select
    c.id::text,
    c.name::text,
    c.jid::text as jid,
    c.client_id::text,
    cl.display_name::text as client_display_name,
    case when caller_email = 'ursache.andrei1995@gmail.com' then cp.phone::text else null end as phone,
    c.photo_url::text,
    c.last_message_preview::text,
    c.last_message_at
  from public.conversations c
  left join public.clients cl on cl.id::text = c.client_id::text
  left join public.clients_private cp on cp.client_id::text = cl.id::text
  where c.id::text = p_conv_id;
end;
$$;
`;

        await client.query(sql);
        console.log("SQL Queries applied successfully.");
        
        // Verification queries
        const resMissing = await client.query("select count(*) as missing_display_name from public.clients where display_name is null or trim(display_name) = '';");
        console.log("missing_display_name =", resMissing.rows[0].missing_display_name);

        const resClients = await client.query("select id, display_name from public.clients where display_name ~ '^Client\\s*[0-9]+$' order by (regexp_replace(display_name,'^Client\\s+','')::int) limit 5;");
        console.table(resClients.rows);

        const resConvs = await client.query("select id, client_display_name, last_message_preview, last_message_at from public.conversations_public order by last_message_at desc limit 5;");
        console.table(resConvs.rows);

        await client.end();
    } catch (e) {
        console.error("FAIL:", e.message);
    }
}
run();
