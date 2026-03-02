// assign_client_names.js (CommonJS)
// Usage:
//   export DATABASE_URL="postgres://user:pass@host:5432/dbname"
//   node assign_client_names.js [--dry]
//
// Requirements:
//   npm i pg
// Notes:
//   - Use a DB URL with privileges to update clients and create view (service role).
//   - Script is idempotent and will not overwrite existing display_name values.

const { Client } = require('pg');
const process = require('process');

const dryRun = process.argv.includes('--dry');
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: Please set DATABASE_URL env var (postgres connection string).');
  process.exit(1);
}

const client = new Client({
  connectionString: DATABASE_URL,
  // If Supabase requires SSL, enable it. Adjust as needed for your environment.
  ssl: (process.env.DB_SSL === 'true') ? { rejectUnauthorized: false } : false
});

async function main() {
  await client.connect();
  console.log(new Date().toISOString(), `Connected to DB (dryRun=${dryRun})`);

  try {
    // 0) Ensure index to help performance
    console.log('Ensuring index idx_messages_conversation_created_at...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at
      ON public.messages(conversation_id, created_at);
    `);

    // 1) Get clients ordered by first message time
    console.log('Querying clients with messages (first message timestamp)...');
    const firstTsRes = await client.query(`
      SELECT cl.id AS client_id, MIN(m.created_at) AS first_ts
      FROM public.clients cl
      JOIN public.conversations c ON c.client_id = cl.id
      JOIN public.messages m ON m.conversation_id = c.id
      GROUP BY cl.id
      ORDER BY MIN(m.created_at) ASC
    `);

    const clientsWithTs = firstTsRes.rows;
    console.log('Clients with messages:', clientsWithTs.length);

    // 2) Update clients with messages (only those without display_name)
    let updatedCount = 0;
    for (let i = 0; i < clientsWithTs.length; i++) {
      const rn = i + 1;
      const clientId = clientsWithTs[i].client_id;
      const newName = `Client ${rn}`;

      if (dryRun) {
        const check = await client.query(
          `SELECT display_name FROM public.clients WHERE id = $1`,
          [clientId]
        );
        const cur = check.rows[0] ? check.rows[0].display_name : null;
        if (!cur || cur.toString().trim() === '') {
          console.log(`[DRY] Would set client ${clientId} -> "${newName}"`);
        }
      } else {
        const upd = await client.query(
          `UPDATE public.clients
           SET display_name = $1
           WHERE id = $2
             AND (display_name IS NULL OR trim(display_name) = '')
           RETURNING id`,
          [newName, clientId]
        );
        if (upd.rowCount > 0) updatedCount += upd.rowCount;
      }
    }
    console.log(`Updated (clients with messages) count: ${updatedCount}`);

    // 3) Find current max rn used (Client N)
    const maxRnRes = await client.query(`
      SELECT COALESCE(MAX( (regexp_replace(display_name, '^Client\\s+', '')::int) ), 0) AS max_rn
      FROM public.clients
      WHERE display_name ~ '^Client\\s+[0-9]+$'
    `);
    let maxRn = parseInt(maxRnRes.rows[0].max_rn || 0, 10);
    if (isNaN(maxRn)) maxRn = 0;
    console.log('Current max Client N:', maxRn);

    // 4) Remaining clients without display_name
    const remRes = await client.query(`
      SELECT id
      FROM public.clients
      WHERE (display_name IS NULL OR trim(display_name) = '')
      ORDER BY COALESCE(created_at, now()), id
    `);
    const remaining = remRes.rows;
    console.log(`Remaining clients without display_name: ${remaining.length}`);

    let assigned = 0;
    for (let i = 0; i < remaining.length; i++) {
      const idx = maxRn + i + 1;
      const name = `Client ${idx}`;
      const clientId = remaining[i].id;

      if (dryRun) {
        console.log(`[DRY] Would set client ${clientId} -> "${name}"`);
      } else {
        const upd = await client.query(`
          UPDATE public.clients
          SET display_name = $1
          WHERE id = $2
            AND (display_name IS NULL OR trim(display_name) = '')
          RETURNING id
        `, [name, clientId]);
        if (upd.rowCount > 0) assigned += upd.rowCount;
      }
    }
    if (!dryRun) {
      console.log(`Assigned ${assigned} display_name(s) to remaining clients.`);
    }

    // 5) Create / replace view for UI
    console.log('Creating/replacing view public.conversations_public ...');
    if (!dryRun) {
      await client.query(`
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
      `);
      // grant select to authenticated (adjust if your RLS differs)
      await client.query(`GRANT SELECT ON public.conversations_public TO authenticated;`);
    } else {
      console.log('[DRY] Would create/replace view public.conversations_public');
    }

    // 6) Post-checks
    const miss = await client.query(`
      SELECT count(*) as missing FROM public.clients WHERE display_name IS NULL OR trim(display_name) = '';
    `);
    console.log('Clients still missing display_name:', miss.rows[0].missing);

    const sample = await client.query(`
      SELECT id, display_name
      FROM public.clients
      ORDER BY display_name
      LIMIT 40;
    `);
    console.log('Sample clients (first 40):');
    console.table(sample.rows);

    const convSample = await client.query(`
      SELECT id, client_display_name, last_message_preview
      FROM public.conversations_public
      ORDER BY last_message_at DESC
      LIMIT 20;
    `);
    console.log('Sample conversations_public:');
    console.table(convSample.rows);

    console.log('Done.');
  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await client.end();
    console.log('Disconnected.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
