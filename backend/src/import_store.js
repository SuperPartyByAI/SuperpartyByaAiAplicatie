const fs = require('fs');
const path = require('path');
const { initSupabase, processBaileysMessage } = require('./database-sync');
require('dotenv').config();

const STORE_FILE = path.resolve(process.cwd(), 'baileys_store_multi.json');

async function main() {
  initSupabase({ storageBucket: process.env.SUPABASE_STORAGE_BUCKET });

  if (!fs.existsSync(STORE_FILE)) {
    console.error('Store file not found:', STORE_FILE);
    process.exit(1);
  }

  console.log('Loading store:', STORE_FILE);
  const raw = fs.readFileSync(STORE_FILE, 'utf8');
  const storeJson = JSON.parse(raw);

  let messagesMap = null;
  if (storeJson && storeJson.messages) {
    messagesMap = new Map(Object.entries(storeJson.messages));
  } else {
    console.error('Could not find messages in store');
    process.exit(1);
  }

  console.log('Chats to process:', messagesMap.size);

  let processed = 0;
  for (const [jid, msgs] of messagesMap) {
    console.log(`Processing ${jid} (${Array.isArray(msgs) ? msgs.length : 'unknown'} messages)`);
    const arr = Array.isArray(msgs) ? msgs : Array.from(msgs);

    for (const m of arr) {
      try {
        await processBaileysMessage(m, { downloadMedia: false }); 
        processed++;
        if (processed % 100 === 0) {
          console.log(`Processed ${processed} messages...`);
        }
      } catch (e) {
        console.error('Error processing message', m?.key?.id, e && e.message);
      }
    }
  }

  console.log(`Done. Processed ${processed} messages.`);
  process.exit(0);
}

main().catch(err => {
  console.error('Import failed', err);
  process.exit(1);
});
