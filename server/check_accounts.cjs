const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:Andrei209521%21@db.ilkphpidhuytucxlglqi.supabase.co:5432/postgres' });
async function check() {
  await client.connect();
  const res = await client.query(`
    select id, jid, account_label, connected, connected_at, last_ping_at, auth_version
    from public.wa_accounts
    order by connected desc, last_ping_at desc
    limit 20;
  `);
  console.table(res.rows);
  await client.end();
}
check().catch(console.error);
