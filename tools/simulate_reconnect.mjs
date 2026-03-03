// tools/simulate_reconnect.mjs
// Usage:
//   export SUPABASE_URL=...
//   export SUPABASE_SERVICE_KEY=...
//   node tools/simulate_reconnect.mjs

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { processBaileysMessagesBatch } = await import(path.join(__dirname, '..', 'server', 'reconciler.mjs'));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY in env');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function ensureTestClient(phone) {
  const { data: cp } = await supabase.from('clients_private').select('client_id').eq('phone', phone).limit(1);
  if (cp && cp.length) return cp[0].client_id;

  const { data: newClient } = await supabase.from('clients').insert({ display_name: 'Client Test', source: 'simulate' }).select('id').single();
  const clientId = newClient.id;
  await supabase.from('clients_private').insert({ client_id: clientId, phone });
  return clientId;
}

async function ensureTestConversation(accountId, clientId, canonicalJid) {
  const { data: conv } = await supabase.from('conversations').select('id').eq('account_id', accountId).eq('jid', canonicalJid).limit(1);
  if (conv && conv.length) return conv[0].id;
  const { data: newConv, error } = await supabase.from('conversations').insert({
    id: `${accountId}_${canonicalJid}`,
    account_id: accountId,
    client_id: clientId,
    jid: canonicalJid
  }).select('id').single();
  if (error) throw new Error('ensureTestConversation insert failed: ' + JSON.stringify(error));
  return newConv.id;
}

function createFakeBaileysMessage(remoteJid, text, tsSeconds = Math.floor(Date.now()/1000), waId = null) {
  return {
    key: { remoteJid, participant: remoteJid, id: waId || `msg-${Math.random().toString(36).slice(2,9)}` },
    messageTimestamp: tsSeconds,
    message: {
      conversation: text
    }
  };
}

async function main() {
  const phone = '+40700000000'; // test phone
  
  // Find a valid account ID instead of creating one, since wa_accounts requires valid logic or maybe just insert
  // Actually, try to get existing first
  const { data: accs } = await supabase.from('wa_accounts').select('id').limit(1);
  if (!accs || accs.length === 0) {
      console.log('No WhatsApp accounts found in DB to link to!');
      process.exit(1);
  }
  const accountId = accs[0].id;
  console.log('Using account ID:', accountId);

  const clientId = await ensureTestClient(phone);
  console.log('clientId', clientId);

  const canonicalJid = `${phone.replace('+','')}@s.whatsapp.net`;
  const convId = await ensureTestConversation(accountId, clientId, canonicalJid);
  console.log('conversationId', convId);

  const msgs = [
    createFakeBaileysMessage(canonicalJid, 'Hello from simulate 1', Math.floor(Date.now()/1000) - 60, 'waid-sim-1'),
    createFakeBaileysMessage(canonicalJid, 'Hello from simulate 2', Math.floor(Date.now()/1000) - 50, 'waid-sim-2'),
    createFakeBaileysMessage(canonicalJid, 'Hello from simulate 3', Math.floor(Date.now()/1000) - 40, 'waid-sim-3')
  ];

  const map = {};
  map[canonicalJid] = convId;

  console.log('Processing fake messages batch...');
  await processBaileysMessagesBatch(msgs, map);

  const { data: inserted } = await supabase
    .from('messages')
    .select('id, wa_message_id, body, timestamp')
    .eq('conversation_id', convId)
    .order('timestamp', { ascending: true });

  console.log('Inserted messages for conv:', inserted);
}

main().catch(e => { console.error(e); process.exit(1); });
