const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:Andrei209521!@db.ilkphpidhuytucxlglqi.supabase.co:5432/postgres' });
async function check() {
  try {
    await client.connect();
    console.log('--- 1. BAZA DE DATE WA_ACCOUNTS ---');
    let res = await client.query('select id, jid, account_label, connected, connected_at, last_ping_at, auth_version from public.wa_accounts order by connected desc, last_ping_at desc limit 10;');
    console.table(res.rows);
    
    console.log('--- 2. LAST 20 MESSAGES ---');
    res = await client.query('select id, conversation_id, substring(text from 1 for 30) as text_preview, type, wa_message_id, from_me, push_name, created_at from public.messages order by created_at desc limit 20;');
    console.table(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
check();
