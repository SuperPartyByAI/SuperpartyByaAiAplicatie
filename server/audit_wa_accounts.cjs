const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL || 'https://ilkphpidhuytucxlglqi.supabase.co', process.env.SUPABASE_SERVICE_KEY);

async function checkCols() {
    // We already know from `session-manager.js` telemetry that the developer's "wa_sessions" 
    // is named "wa_accounts" in this codebase.
    // Telemetry updates `status` and `recent_logs`.
    const { data, error } = await supabase.from('wa_accounts').select('id, status, label').limit(5);
    if (error) console.error("Error fetching wa_accounts:", error);
    else console.log("wa_accounts sample:", data);
}
checkCols();
