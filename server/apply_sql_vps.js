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
    
    console.log("Connecting via IPv6 to " + config.host);
    const client = new Client(config);
    try {
        await client.connect();
        const sql = `
        CREATE OR REPLACE VIEW public.conversations_public AS
        SELECT
          c.id, c.name, c.jid, c.client_id, c.account_label, c.photo_url,
          c.last_message_at, c.last_message_preview, c.assigned_employee_id, COALESCE(c.name, cl.display_name) as client_display_name
        FROM public.conversations c LEFT JOIN public.clients cl ON cl.id::text = c.client_id::text;
        
        GRANT SELECT ON public.conversations_public TO authenticated;
        
        create index if not exists idx_conversations_last_message_at on public.conversations (last_message_at desc);
        drop function if exists public.get_conversations_page(integer, integer);
        create or replace function public.get_conversations_page(p_page integer, p_page_size integer)
        returns table (id text, name text, jid text, client_id text, account_label text, photo_url text, last_message_at bigint, last_message_preview text, assigned_employee_id text, client_display_name text)
        language plpgsql security definer as $$
        declare
          page_size int := least(coalesce(p_page_size,50), 100);
          v_offset int := greatest((coalesce(p_page,0) * page_size), 0);
        begin
          return query select c.id::text, c.name::text, c.jid::text as jid, c.client_id::text, c.account_label::text, c.photo_url::text, c.last_message_at::bigint, c.last_message_preview::text, c.assigned_employee_id::text, COALESCE(c.name, cl.display_name)::text as client_display_name
          from public.conversations c LEFT JOIN public.clients cl ON cl.id::text = c.client_id::text
          order by c.last_message_at desc nulls last limit page_size offset v_offset;
        end; $$;
        `;
        await client.query(sql);
        console.log("SUCCESS! SQL executed!");
        await client.end();
    } catch (e) {
        console.error("FAIL:", e.message);
    }
}
run();
