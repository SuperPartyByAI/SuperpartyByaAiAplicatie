const { Client } = require('pg');

async function testConnection() {
    const config = {
        host: 'aws-0-eu-central-1.pooler.supabase.com',
        port: 6543,
        user: 'postgres.oykpxhshdudjowxczlvw',
        password: 'Andrei209521!',
        database: 'postgres',
        ssl: { rejectUnauthorized: false }
    };
    
    console.log("Testing with Host: " + config.host + " User: " + config.user);
    const client = new Client(config);
    try {
        await client.connect();
        console.log("SUCCESS Connected to oyk...!");
        await client.end();
        return true;
    } catch (e) {
        console.log("FAIL oyk:", e.message);
        return false;
    }
}

testConnection();
