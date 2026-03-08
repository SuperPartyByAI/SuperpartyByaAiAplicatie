#!/bin/bash
TARGET_FILE="/opt/superparty-ai/repo/server/voice-service/index.js"
ENV_FILE="/opt/superparty-ai/repo/server/voice-service/.env"

# Inject or Edit REDIS_URL to 172.17.0.1 (Docker Gateway Bridge IP) Host Loopback alternative
sed -i 's|redis://127.0.0.1:6379|redis://172.17.0.1:6380|g' "$TARGET_FILE"

if grep -q "REDIS_URL" "$ENV_FILE"; then
  sed -i 's|^REDIS_URL=.*|REDIS_URL=redis://172.17.0.1:6380|' "$ENV_FILE"
else
  echo -e "\nREDIS_URL=redis://172.17.0.1:6380" >> "$ENV_FILE"
fi

cd /opt/superparty-ai/repo/server/voice-service
docker compose up -d --build --force-recreate
sleep 5
docker logs superparty-voice
