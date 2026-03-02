-- 02_rpc_get_conversation.sql
create or replace function public.get_conversation(conv_id text)
returns table(
  id text,
  name text,
  jid text,
  phone text,
  photo_url text,
  assigned_employee_id text,
  account_label text,
  created_at timestamptz
)
language plpgsql
security definer
as $$
declare
  caller_email text;
begin
  caller_email := current_setting('request.jwt.claims.email', true);

  return query
  select
    c.id,
    c.name,
    c.jid,
    case when caller_email = 'ursache.andrei1995@gmail.com' then pri.phone else null end as phone,
    c.photo_url,
    c.assigned_employee_id,
    c.account_label,
    c.created_at
  from public.conversations c
  left join public.clients cli on c.client_id = cli.id
  left join public.clients_private pri on cli.id = pri.client_id
  where c.id = conv_id;

  if caller_email = 'ursache.andrei1995@gmail.com' then
    insert into public.phone_access_log(email, conv_id, client_ip, ts)
    values (
      caller_email,
      conv_id,
      current_setting('request.headers', true)::json->>'x-forwarded-for',
      now()
    );
  end if;
end;
$$;
