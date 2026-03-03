const { Client } = require('pg');
const { execSync } = require('child_process');

const client = new Client({ connectionString: 'postgresql://postgres:Andrei209521%21@db.ilkphpidhuytucxlglqi.supabase.co:5432/postgres' });
async function run() {
  await client.connect();
  console.log('--- 1. BAZA DE DATE WA_ACCOUNTS ---');
  let res = await client.query('select id, jid, account_label, connected, connected_at, last_ping_at, auth_version from public.wa_accounts order by connected desc, last_ping_at desc limit 10;');
  console.table(res.rows);
  
  console.log('--- 2. AUTH INFO FOLDERS ---');
  try {
    const authList = execSync('ls -la /root/whatsapp-integration-v6/auth_info | head -n 15', { encoding: 'utf8' });
    console.log(authList);
  } catch(e) { console.log('Error reading auth_info:', e.message); }

  console.log('--- 3. PM2 LOGS ---');
  try {
    const pm2Logs = execSync("pm2 logs whatsapp-integration-v6 --lines 150 --nostream | grep -iE 'CREDS|SessionManager|CONNECTED|DISCONNECT|Reconciler|sync|messages.upsert|ReferenceError|error' | tail -n 40", { encoding: 'utf8' });
    console.log(pm2Logs);
  } catch(e) { console.log('Error reading pm2 logs:', e.message); }

  console.log('--- 4. LAST 20 MESSAGES ---');
  res = await client.query('select id, conversation_id, text, type, wa_message_id, from_me, push_name, created_at from public.messages order by created_at desc limit 20;');
  console.table(res.rows);

  await client.end();
}
run().catch(console.error);
