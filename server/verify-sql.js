const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:Andrei209521%21@db.ilkphpidhuytucxlglqi.supabase.co:5432/postgres'
});

async function verify() {
  await client.connect();
  const res = await client.query(`
    select id, state, connected_at, last_ping_at, qr_code is not null as has_qr
    from public.wa_accounts
    order by updated_at desc nulls last
    limit 10;
  `);
  console.log('✅ BAZA DE DATE ACTUALIZATA:');
  console.table(res.rows);
  await client.end();
}

verify().catch(console.error);
