const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const client = new Client({
    connectionString: 'postgresql://postgres.ilkphpidhuytucxlglqi:Andrei209521%21@aws-0-eu-central-1.pooler.supabase.com:6543/postgres'
  });

  try {
    await client.connect();
    console.log('Connected to DB via Pooler');
    const sqlPath = path.join(__dirname, 'ai-manager/migrations/007_driver_inventory_evidence_module.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await client.query(sql);
    console.log('Migration 007 successfully applied.');
  } catch (err) {
    console.error('Error applying migration:', err);
  } finally {
    await client.end();
  }
}

runMigration();
