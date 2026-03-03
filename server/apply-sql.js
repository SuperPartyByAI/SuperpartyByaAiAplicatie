const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:Andrei209521%21@db.ilkphpidhuytucxlglqi.supabase.co:5432/postgres'
});

async function runPatch() {
  await client.connect();
  console.log('✅ Connected DB via IPv6!');

  const sql1 = `
    alter table public.wa_accounts
      add column if not exists qr_code text null,
      add column if not exists requires_qr boolean default false,
      add column if not exists needs_qr_since timestamptz null,
      add column if not exists connected_at timestamptz null,
      add column if not exists last_ping_at timestamptz null,
      add column if not exists updated_at timestamptz null;
  `;
  await client.query(sql1);
  console.log('✅ Columns added!');

  const sql2 = `
    do $$
    begin
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'wa_accounts'
      ) then
        alter publication supabase_realtime add table public.wa_accounts;
      end if;
    end $$;
  `;
  await client.query(sql2);
  console.log('✅ Realtime publication updated!');

  const sql3 = "select pg_notify('pgrst', 'reload schema');";
  await client.query(sql3);
  console.log('✅ PostgREST schema cache reloaded!');

  await client.end();
}

runPatch().catch(err => {
  console.error(err);
  process.exit(1);
});
