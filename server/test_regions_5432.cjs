const { Client } = require('pg');

const regions = [
    'eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3',
    'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2'
];

async function testConnection(region) {
    const config = {
        host: `aws-0-${region}.pooler.supabase.com`,
        port: 5432,
        user: 'postgres.ilkphpidhuytucxlglqi',
        password: 'Andrei209521!',
        database: 'postgres',
        ssl: { rejectUnauthorized: false }
    };
    
    const client = new Client(config);
    try {
        await client.connect();
        console.log("SUCCESS region port 5432:", region);
        await client.end();
        return true;
    } catch (e) {
        if (!e.message.includes("Tenant or user not found") && !e.message.includes("Timeout")) {
            console.log(`Failed ${region} 5432 with: ${e.message}`);
        }
        return false;
    }
}

async function run() {
    for (const region of regions) {
        if (await testConnection(region)) {
             console.log("Found region on 5432:", region);
             return;
        }
    }
    console.log("Not found on 5432 either.");
}
run();
