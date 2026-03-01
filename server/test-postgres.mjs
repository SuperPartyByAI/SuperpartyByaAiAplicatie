
import pg from 'pg';

const connectionString = 'postgresql://postgres.oykpxhshdudjowxczlvw:-YyY78uL84#j6Wn@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';
const client = new pg.Client({ connectionString });

async function checkSchema() {
  await client.connect();

  console.log('=== 1A) TABLES ===');
  const res1 = await client.query(`
    SELECT tablename FROM pg_tables WHERE schemaname='public'
    AND tablename IN ('conversations','messages','wa_accounts','employees','calls','app_inbox') ORDER BY tablename;
  `);
  console.table(res1.rows);

  console.log('
=== 1B) COLUMNS ===');
  const res2 = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable, column_default 
    FROM information_schema.columns WHERE table_schema='public' 
    AND table_name IN ('conversations','messages','wa_accounts','employees','calls','app_inbox') ORDER BY table_name, ordinal_position;
  `);
  console.table(res2.rows);

  console.log('
=== 2A) CONSTRAINTS ===');
  const res3 = await client.query(`
    SELECT tc.table_name, tc.constraint_type, tc.constraint_name 
    FROM information_schema.table_constraints tc WHERE tc.table_schema='public' 
    AND tc.table_name IN ('conversations','messages','wa_accounts','employees','calls','app_inbox') ORDER BY tc.table_name, tc.constraint_type;
  `);
  console.table(res3.rows);

  console.log('
=== 2B) FOREIGN KEYS ===');
  const res4 = await client.query(`
    SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name 
    FROM information_schema.table_constraints AS tc JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name 
    JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name 
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='public' ORDER BY tc.table_name;
  `);
  console.table(res4.rows);

  console.log('
=== 3A) INDEXES ===');
  const res5 = await client.query(`
    SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('messages','conversations') ORDER BY tablename, indexname;
  `);
  console.table(res5.rows);

  console.log('
=== 4B) POLICIES ===');
  const res6 = await client.query(`
    SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename IN ('conversations','messages','wa_accounts','employees','calls','app_inbox') ORDER BY tablename, policyname;
  `);
  console.table(res6.rows);

  console.log('
=== 5A) REALTIME PUBLICATION ===');
  const res7 = await client.query(`
    SELECT pubname, schemaname, tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' ORDER BY tablename;
  `);
  console.table(res7.rows);

  console.log('
=== 6A) TIMESTAMPS SANITY ===');
  const res8 = await client.query(`
    SELECT MIN(timestamp) AS min_ts, MAX(timestamp) AS max_ts, AVG(timestamp) AS avg_ts FROM messages;
  `);
  console.table(res8.rows);

  await client.end();
}

checkSchema().catch(console.error);
