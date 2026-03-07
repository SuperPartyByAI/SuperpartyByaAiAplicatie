#!/bin/bash
set -e
cd /opt/superparty-ai/repo/server/ai-manager
git checkout -- .
git clean -fd
git pull origin main
docker compose down
docker compose up -d --build
sleep 15
TRIP_RES=$(curl -s -X POST http://localhost:3002/trips/start -H "Content-Type: application/json" -H "Authorization: Bearer superparty-ai-admin-2026" -d '{"employeeId":"emp-batch-test"}')
TRIP_ID=$(echo "$TRIP_RES" | grep -o '"id":"[^"]*"' | cut -d'"' -f4 | head -1)
echo "Trip ID created: $TRIP_ID"
curl -s -X POST http://localhost:3002/trips/locations -H "Content-Type: application/json" -H "Authorization: Bearer superparty-ai-admin-2026" -d '{"locations": [{"employeeId":"emp-batch-test","tripId":"'$TRIP_ID'","lat":44.4396,"lng":26.0963,"speedKmh":45.5},{"employeeId":"emp-batch-test","tripId":"'$TRIP_ID'","lat":44.0,"lng":26.0,"speedKmh":14.5}]}'
echo "TEST_COMPLETED"
