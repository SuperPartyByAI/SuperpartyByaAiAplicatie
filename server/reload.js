const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  console.log("Reloading schema cache...");
  const { data, error } = await supabase.rpc('reload_schema_cache');
  if (error) {
     console.log("RPC reload_schema_cache not found, trying raw SQL...");
     // Note: we can't do raw queries from standard client easily unless we use postgres driver
  } else {
     console.log("Reloaded via RPC:", data);
     return;
  }
}

main();
