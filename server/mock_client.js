const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:Andrei209521%21@db.ilkphpidhuytucxlglqi.supabase.co:5432/postgres' });
async function mock() {
  await client.connect();
  const clRes = await client.query("insert into public.clients (display_name, phone_number, created_at, updated_at) values ('TEST_CLIENT_MANUAL', '40700000000', now(), now()) returning id;");
  const cId = clRes.rows[0].id;
  const cvRes = await client.query(`insert into public.conversations (client_id, canonical_jid, name, last_message_at, updated_at) values ('${cId}', 'test-jid-9999@s.whatsapp.net', null, now(), now()) returning id;`);
  console.log('MOCK Client ID:', cId);
  console.log('MOCK Convo ID:', cvRes.rows[0].id);
  await client.end();
}
mock().catch(console.error);
