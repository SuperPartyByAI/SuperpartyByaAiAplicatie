-- 01_schema_clients.sql
-- 1.1) coloane pentru soft delete în clients
alter table public.clients
  add column if not exists is_deleted boolean default false not null,
  add column if not exists deleted_at timestamptz null,
  add column if not exists deleted_by uuid null;

-- 1.2) index pentru query-uri eficiente
create index if not exists idx_clients_is_deleted on public.clients(is_deleted);

-- Prevent DELETE physical default
create or replace function public.prevent_delete_clients()
returns trigger as $$
begin
  raise exception 'Physical delete on clients is not allowed. Use soft-delete or admin_anonymize_client(client_id).';
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_prevent_delete_clients on public.clients;
create trigger trg_prevent_delete_clients
  before delete on public.clients
  for each row execute procedure public.prevent_delete_clients();

-- 1.3 Change FK if needed (Assuming conversations_client_id_fkey exists)
alter table public.conversations drop constraint if exists conversations_client_id_fkey;
alter table public.conversations add constraint conversations_client_id_fkey
    foreign key (client_id) references public.clients(id) on delete set null;

-- 1.4 Admin anonymize flow
create or replace function public.admin_anonymize_client(p_client_id uuid, p_by uuid)
returns void as $$
begin
  update public.clients set
    display_name = concat('Client ', substring(gen_random_uuid()::text,1,8)),
    updated_at = now()
  where id = p_client_id;

  update public.clients_private set phone = null where client_id = p_client_id;

  insert into public.phone_access_log(email, conv_id, client_ip, ts)
  values ('system-anonymize', p_client_id, null, now());
end;
$$ language plpgsql security definer;

-- 1.5 Sync markers for reconciler
alter table public.conversations add column if not exists last_synced_at timestamptz;
alter table public.wa_accounts add column if not exists last_synced_at timestamptz;
