const { Client } = require('pg');

const regions = [
    'aws-0-eu-central-1', 'aws-0-eu-west-1', 'aws-0-eu-west-2', 'aws-0-eu-west-3',
    'aws-0-us-east-1', 'aws-0-us-east-2', 'aws-0-us-west-1', 'aws-0-us-west-2',
    'aws-0-ap-southeast-1', 'aws-0-ap-northeast-1', 'aws-0-ap-south-1',
    'aws-0-sa-east-1', 'aws-0-ca-central-1'
];

async function testConnection(region) {
    const config = {
        host: `${region}.pooler.supabase.com`,
        port: 6543,
        user: 'postgres.ilkphpidhuytucxlglqi',
        password: 'Andrei209521!',
        database: 'postgres',
        ssl: { rejectUnauthorized: false }
    };
    
    const client = new Client(config);
    try {
        await client.connect();
        console.log("SUCCESS region:", region);
        
        const sql = `
        CREATE OR REPLACE VIEW public.conversations_public AS
        SELECT
          c.id, c.name, c.canonical_jid as jid, c.client_id, c.account_label, c.photo_url,
          c.last_message_at, c.last_message_preview, c.assigned_employee_id,
          COALESCE(c.name, cl.display_name) as client_display_name
        FROM public.conversations c LEFT JOIN public.clients cl ON cl.id = c.client_id;
        GRANT SELECT ON public.conversations_public TO authenticated;
        
        create index if not exists idx_conversations_last_message_at on public.conversations (last_message_at desc);
        drop function if exists public.get_conversations_page(integer, integer);
        create or replace function public.get_conversations_page(p_page integer, p_page_size integer)
        returns table (id uuid, name text, jid text, client_id uuid, account_label text, photo_url text, last_message_at timestamptz, last_message_preview text, assigned_employee_id uuid, client_display_name text)
        language plpgsql security definer as $$
        declare
          page_size int := least(coalesce(p_page_size,50), 100);
          v_offset int := greatest((coalesce(p_page,0) * page_size), 0);
        begin
          return query select c.id, c.name, c.canonical_jid as jid, c.client_id, c.account_label, c.photo_url, c.last_message_at, c.last_message_preview, c.assigned_employee_id, COALESCE(c.name, cl.display_name) as client_display_name
          from public.conversations c LEFT JOIN public.clients cl ON cl.id = c.client_id
          order by c.last_message_at desc nulls last limit page_size offset v_offset;
        end; $$;
        `;
        await client.query(sql);
        console.log("SQL Queries applied successfully.");
        await client.end();
        return true;
    } catch (e) {
        if (!e.message.includes("Tenant or user not found")) {
            console.log(`Failed ${region} with: ${e.message}`);
        }
        return false;
    }
}

async function run() {
    for (const region of regions) {
        if (await testConnection(region)) {
             console.log("Found region and applied SQL:", region);
             break;
        }
    }
}
run();
