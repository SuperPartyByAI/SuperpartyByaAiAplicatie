#!/bin/bash
cat << 'EOF' > /opt/superparty-ai/repo/server/voice-service/docker-compose.yml
version: '3.8'

services:
  voice-service:
    build: .
    container_name: superparty-voice
    restart: always
    env_file:
      - .env
    ports:
      - "3001:3001"
    volumes:
      - ./logs:/usr/src/app/logs
    deploy:
      resources:
        limits:
          memory: 1G
    logging:
      driver: "json-file"
      options:
        max-size: "50m"
        max-file: "5"
    networks:
      - ai-manager_default

networks:
  ai-manager_default:
    external: true
EOF

sed -i 's/^REDIS_HOST=.*$/REDIS_HOST=superparty-ai-redis/' /opt/superparty-ai/repo/server/voice-service/.env
sed -i 's/^REDIS_PORT=.*$/REDIS_PORT=6379/' /opt/superparty-ai/repo/server/voice-service/.env

cd /opt/superparty-ai/repo/server/voice-service
docker compose up -d --force-recreate
sleep 3
docker logs superparty-voice
