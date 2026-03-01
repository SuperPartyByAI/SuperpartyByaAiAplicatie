import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

// Attempt to load proper credentials
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ilkphpidhuytucxlglqi.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

if (!SUPABASE_KEY) {
  console.error("Missing SUPABASE_SERVICE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkMetrics() {
  console.log("=== SUPABASE WHATSAPP SYNC DIAGNOSTICS ===\n");

  // 1 & 2. COUNTS
  const { count: conv_count, error: err1 } = await supabase.from('conversations').select('*', { count: 'exact', head: true });
  console.log(`1) conv_count: ${conv_count ?? 'Error: ' + err1?.message}`);

  const { count: msg_count, error: err2 } = await supabase.from('messages').select('*', { count: 'exact', head: true });
  console.log(`2) msg_count:  ${msg_count ?? 'Error: ' + err2?.message}`);

  // 3. MIN / MAX TIMESTAMP
  const { data: minData } = await supabase.from('messages').select('timestamp').order('timestamp', { ascending: true }).limit(1);
  const { data: maxData } = await supabase.from('messages').select('timestamp').order('timestamp', { ascending: false }).limit(1);

  const min_ts = minData?.[0]?.timestamp;
  const max_ts = maxData?.[0]?.timestamp;
  console.log(`3) min_ts:     ${min_ts}`);
  console.log(`   max_ts:     ${max_ts}`);

  if (max_ts) {
    if (String(max_ts).length >= 13) {
      console.log('   ⚠️ VERDICT FORMAT: Timestamps sunt in MILISECUNDE! (Necesita conversie SQL)');
    } else {
      console.log('   ✅ VERDICT FORMAT: Timestamps sunt in SECUNDE. (Corect)');
    }
  }

  // 4. FK RELATIONSHIP (Messages -> Conversations)
  const { error: fkErr } = await supabase.from('messages').select('id, conversations!inner(id)').limit(1);
  if (fkErr && fkErr.message.toLowerCase().includes('relationship')) {
    console.log(`4) FK Check:   ❌ LIPSĂ FOREIGN KEY (Orphan messages pot exista). Eroare: ${fkErr.message}`);
  } else if (fkErr) {
    console.log(`4) FK Check:   Eroare ruting: ${fkErr.message}`);
  } else {
    console.log(`4) FK Check:   ✅ Foreign Key Mappings există. Relatia Message -> Conversation e validă.`);
  }
}

checkMetrics().catch(console.error);
