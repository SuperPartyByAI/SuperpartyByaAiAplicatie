const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://ilkphpidhuytucxlglqi.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
if (!supabaseKey) { console.error('NO SUPABASE KEY'); process.exit(1); }

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('==== LATEST MESSAGES IN DB ====');
  const { data, error } = await supabase
    .from('messages')
    .select('id, conversation_id, content, created_at, direction')
    .order('created_at', { ascending: false })
    .limit(5);
    
  if (error) console.error('DB Error:', error);
  else console.log(data);
  process.exit(0);
}
run();
