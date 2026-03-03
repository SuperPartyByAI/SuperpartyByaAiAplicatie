const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://ilkphpidhuytucxlglqi.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
if (!supabaseKey) { console.error('NO SUPABASE KEY'); process.exit(1); }

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('==== 6. DATABASE SECURITY CHECK ====');
  // Check for exposed phone numbers in 'name'
  const { data, error } = await supabase
    .from('conversations_public')
    .select('id, name')
    .filter('name', 'ilike', '%40%') // Contains 40 or numeric
    .limit(10);
    
  if (error) console.error('DB Error:', error);
  else {
      const suspect = data.filter(d => d.name && /^\+?[0-9]{6,}/.test(d.name));
      console.log('Suspect PII records found:', suspect.length);
      if(suspect.length > 0) console.log(suspect);
  }
}
run();
