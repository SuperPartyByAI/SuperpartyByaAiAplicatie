-- 03_rls_and_policies.sql
alter table public.clients enable row level security;
alter table public.clients_private enable row level security;
alter table public.phone_access_log enable row level security;

-- Basic policy for clients (public info)
create policy "Allow select on clients for authenticated users"
on public.clients for select using (auth.role() = 'authenticated');

-- Interzice DELETE pentru toti (in afara de soft delete update)
create policy "deny_delete_clients" on public.clients
  for delete using (false);

-- RLS for clients_private: ONLY allowed by get_conversation RPC (security definer bypasses RLS) or Service Role
create policy "Deny direct access to clients_private"
on public.clients_private for all using (false);

create policy "Deny direct access to phone_access_log"
on public.phone_access_log for all using (false);
