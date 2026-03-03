import pg from 'pg';
import fs from 'fs';

const connectionString = 'postgresql://postgres.oykpxhshdudjowxczlvw:-YyY78uL84%23j6Wn@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';

const pool = new pg.Pool({ connectionString });

async function extractSchema() {
  try {
    const res = await pool.query(`
      SELECT 
        t.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default
      FROM 
        information_schema.tables t
      JOIN 
        information_schema.columns c ON t.table_name = c.table_name
      WHERE 
        t.table_schema = 'public' 
        AND t.table_type = 'BASE TABLE'
      ORDER BY 
        t.table_name, c.ordinal_position;
    `);

    const tables = {};
    for (const row of res.rows) {
      if (!tables[row.table_name]) tables[row.table_name] = [];
      tables[row.table_name].push(row);
    }

    let md = '# 🗄️ Supabase Public Schema\n\n';
    md += '> Documentație auto-generată conținând toate tabelele și coloanele din baza de date publică Supabase la zi.\n\n';

    for (const tableName of Object.keys(tables).sort()) {
      md += `## Tabel: \`${tableName}\`\n\n`;
      md += '| Coloană | Tip Date | Permite Nul | Implicit |\n';
      md += '| ------- | -------- | ----------- | -------- |\n';
      for (const col of tables[tableName]) {
        const def = col.column_default ? col.column_default.replace(/'/g, "\\'") : '*null*';
        md += `| \`${col.column_name}\` | \`${col.data_type}\` | ${col.is_nullable} | ${def} |\n`;
      }
      md += '\n';
    }

    fs.writeFileSync('../SUPABASE_SCHEMA.md', md, 'utf8');
    console.log('Successfully generated SUPABASE_SCHEMA.md in Superparty-App directory.');
  } catch (err) {
    console.error('Error extracting schema:', err);
  } finally {
    await pool.end();
  }
}

extractSchema();
