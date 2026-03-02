const SUPABASE_URL = "https://ilkphpidhuytucxlglqi.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlsa3BocGlkaHV5dHVjeGxnbHFpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjM0MjU1NiwiZXhwIjoyMDg3OTE4NTU2fQ.zsCNAng5tlP_k9_pt5hSvtOkA2B_H6T63ie5XhjUSIU';

async function check() {
    try {
        const res1 = await fetch(`${SUPABASE_URL}/rest/v1/conversations_public?limit=1`, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        });
        if (!res1.ok) {
            console.error("View error:", await res1.text());
        } else {
            console.log("View exists! Data:", await res1.json());
        }

        const res2 = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_conversations_page`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ p_page: 0, p_page_size: 1 })
        });
        if (!res2.ok) {
            console.error("RPC error:", await res2.text());
        } else {
            console.log("RPC works! Data:", await res2.json());
        }
    } catch(e) {
        console.error(e);
    }
}
check();
