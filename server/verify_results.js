const { Client } = require('pg');

async function run() {
    const config = {
        host: 'db.ilkphpidhuytucxlglqi.supabase.co',
        port: 5432,
        user: 'postgres',
        password: 'Andrei209521!',
        database: 'postgres',
        ssl: { rejectUnauthorized: false }
    };
    
    const client = new Client(config);
    try {
        await client.connect();
        
        console.log("=== VERIFICARE VIEW ===");
        const q1 = await client.query('select id, client_display_name, last_message_preview from public.conversations_public order by last_message_at desc limit 5;');
        console.table(q1.rows);
        
        console.log("\n=== VERIFICARE CLIENTI FARA NUME ===");
        const q2 = await client.query("select count(*) as missing_display_name from public.clients where display_name is null or trim(display_name) = '';");
        console.log("Missing display name count: ", q2.rows[0].missing_display_name);
        
        console.log("\n=== VERIFICARE RPC PAGINATION ===");
        const q3 = await client.query("select * from public.get_conversations_page(0,2);");
        console.table(q3.rows.map(x => ({ jid: x.jid, client_display_name: x.client_display_name })));
        
        await client.end();
    } catch (e) {
        console.error("FAIL:", e.message);
    }
}
run();
