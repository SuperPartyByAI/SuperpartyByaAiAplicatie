const { Client } = require('pg');

async function testConnection() {
    // Parola cu caracter special
    const config = {
        host: 'aws-0-eu-central-1.pooler.supabase.com',
        port: 6543,
        user: 'postgres.ilkphpidhuytucxlglqi',
        password: 'Andrei209521!',
        database: 'postgres',
        ssl: { rejectUnauthorized: false }
    };
    
    console.log("Testing with Host: " + config.host);
    const client = new Client(config);
    try {
        await client.connect();
        console.log("SUCCESS Connected!");
        
        // Dacă am reușit, trimit direct SQL-ul
        const sql = `
        -- 1. Creez view-ul pentru clienți + interfața conversațiilor
        CREATE OR REPLACE VIEW public.conversations_public AS
        SELECT
          c.id,
          c.name,
          c.canonical_jid as jid,
          c.client_id,
          c.account_label,
          c.photo_url,
          c.last_message_at,
          c.last_message_preview,
          c.assigned_employee_id,
          COALESCE(c.name, cl.display_name) as client_display_name
        FROM public.conversations c
        LEFT JOIN public.clients cl ON cl.id = c.client_id;
        
        GRANT SELECT ON public.conversations_public TO authenticated;
        
        -- 2. Înlocuiesc funcția curentă ca lista din Flutter să o ia corect
        create index if not exists idx_conversations_last_message_at on public.conversations (last_message_at desc);
        
        drop function if exists public.get_conversations_page(integer, integer);
        
        create or replace function public.get_conversations_page(p_page integer, p_page_size integer)
        returns table(
          id uuid,
          name text,
          jid text,
          client_id uuid,
          account_label text,
          photo_url text,
          last_message_at timestamptz,
          last_message_preview text,
          assigned_employee_id uuid,
          client_display_name text
        )
        language plpgsql
        security definer
        as $$
        declare
          page_size int := least(coalesce(p_page_size,50), 100);
          v_offset int := greatest((coalesce(p_page,0) * page_size), 0);
        begin
          return query
          select
            c.id, c.name, c.canonical_jid as jid, c.client_id, c.account_label, c.photo_url,
            c.last_message_at, c.last_message_preview, c.assigned_employee_id, COALESCE(c.name, cl.display_name) as client_display_name
          from public.conversations c
          LEFT JOIN public.clients cl ON cl.id = c.client_id
          order by c.last_message_at desc nulls last
          limit page_size offset v_offset;
        end;
        $$;
        `;
        
        await client.query(sql);
        console.log("SQL Queries applied successfully.");
        
        // Testing if view and RPC work
        const res = await client.query('SELECT id, client_display_name, last_message_preview FROM public.conversations_public LIMIT 1;');
        console.log("View data:", res.rows);
        
        const res2 = await client.query('SELECT * FROM public.get_conversations_page(0, 1);');
        console.log("RPC Data:", res2.rows);
        
        await client.end();
        return true;
    } catch (e) {
        console.log("FAIL:", e.message);
        return false;
    }
}

testConnection();
