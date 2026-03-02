const SUPABASE_URL = "https://ilkphpidhuytucxlglqi.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlsa3BocGlkaHV5dHVjeGxnbHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNDI1NTYsImV4cCI6MjA4NzkxODU1Nn0.vO95CLAgt9M1vUr4za9CNVHjuEmeeQWW-qCMnY4_UPE';

async function fetchTable(table, select, orderColumn) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
    url.searchParams.append('select', select);
    url.searchParams.append('order', `${orderColumn}.desc`);
    url.searchParams.append('limit', '20');

    const res = await fetch(url, {
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
        }
    });
    return await res.json();
}

async function run() {
    console.log("=== A) ULTIMELE 20 MESAJE ===");
    const messages = await fetchTable('messages', 'id,conversation_id,from_me,timestamp,text', 'timestamp');
    console.log(JSON.stringify(messages, null, 2));

    console.log("\\n=== B) ULTIMELE 20 CONVERSATII ===");
    const convs = await fetchTable('conversations', 'id,updated_at,last_message_at,last_message_preview,phone,name', 'updated_at');
    console.log(JSON.stringify(convs, null, 2));
}

run().catch(console.error);
