#!/bin/bash
set -e

# Deploy script for standalone voice-service

cd "$(dirname "$0")"

echo "=== Deploying Voice Service ==="

# Pull latest changes (assuming this is part of the repo)
# Adjust branch if necessary
echo "1. Pulling latest code..."
git pull origin main || true

echo "2. Building Docker Image..."
docker compose build

echo "3. Restarting Service..."
docker compose up -d

echo "4. Checking Health..."
sleep 5
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/health || true)

if [ "$HTTP_CODE" == "200" ]; then
    echo "✅ Voice Service deployed successfully and is HEALTHY."
else
    echo "❌ Health check failed (HTTP $HTTP_CODE). Checking logs..."
    docker compose logs --tail=20
    exit 1
fi
