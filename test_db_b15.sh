#!/bin/bash
set -e

echo "=== STARTING E2E VIRTUAL DEVICE TEST ==="
cd /opt/superparty-ai/repo/server/ai-manager
TOKEN="superparty-ai-admin-2026"

echo "1. Simulating App Background + Screen Off (Entering Sediu)..."
curl -s -X POST http://localhost:3002/trips/events -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"employeeId":"emp-virtual-realtest", "identifier":"SEDIU_SUPERPARTY", "action":"ENTER", "lat":44.4396, "lng": 26.0963}'

echo "2. Simulating Dwell (1 min later)..."
curl -s -X POST http://localhost:3002/trips/events -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"employeeId":"emp-virtual-realtest", "identifier":"SEDIU_SUPERPARTY", "action":"DWELL", "lat":44.4396, "lng": 26.0963}'

echo "3. Simulating Exit..."
curl -s -X POST http://localhost:3002/trips/events -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"employeeId":"emp-virtual-realtest", "identifier":"SEDIU_SUPERPARTY", "action":"EXIT", "lat":44.4400, "lng": 26.1000}'

echo "4. Simulating Offline Sync Bulk (Internet Restored)..."
curl -s -X POST http://localhost:3002/trips/locations -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"locations": [{"employeeId":"emp-virtual-realtest","tripId":"pending_local_trip","lat":44.4401,"lng":26.1001,"recordedAt":"2026-03-07T18:00:00Z"}, {"employeeId":"emp-virtual-realtest","tripId":"pending_local_trip","lat":44.4402,"lng":26.1002,"recordedAt":"2026-03-07T18:01:00Z"}]}'

echo ""
echo "=== VERIFYING DATABASE EXPECTATIONS (B2/B3) ==="
cat << 'JS_EOF' > /tmp/verify.mjs
import { queryRows } from './services/supabase.mjs';

async function run() {
  const events = await queryRows('geofence_events', { employee_id: 'emp-virtual-realtest' }, { orderBy: 'recorded_at', ascending: true });
  console.log("Total geofence_events:", events.length);
  
  let duplicateCount = 0;
  const seen = new Set();
  
  events.forEach(e => {
    const key = `${e.geofence_type}_${e.geofence_id}`;
    if(seen.has(key)) duplicateCount++;
    seen.add(key);
    console.log(`[${e.geofence_type}] -> AI Decision: "${e.ai_decision}"`);
  });
  
  console.log("Duplicates detected:", duplicateCount > 0 ? "DA" : "NU");
  
  const movs = await queryRows('employee_movements', { employee_id: 'emp-virtual-realtest' });
  console.log("Total offline sync movements recovered:", movs.length);
}
run().catch(console.error);
JS_EOF

node /tmp/verify.mjs
