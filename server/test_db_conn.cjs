const { Client } = require('pg');

const urls = [
    'postgresql://postgres.ilkphpidhuytucxlglqi:Andrei209521!@aws-0-eu-central-1.pooler.supabase.com:6543/postgres',
    'postgresql://postgres:Andrei209521!@db.ilkphpidhuytucxlglqi.supabase.co:5432/postgres'
];

async function testConnection(url) {
    console.log("Testing:", url.replace(/:Andrei209521!@/, ':***@'));
    const client = new Client({ connectionString: url, rejectUnauthorized: false });
    try {
        await client.connect();
        const res = await client.query('SELECT current_database();');
        console.log("SUCCESS:", res.rows[0]);
        await client.end();
        return true;
    } catch (e) {
        console.error("FAIL:", e.message);
        return false;
    }
}

async function run() {
    for (const url of urls) {
        if (await testConnection(url)) break;
    }
}
run();
