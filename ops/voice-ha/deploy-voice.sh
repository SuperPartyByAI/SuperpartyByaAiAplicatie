#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/superparty}"
BRANCH="${BRANCH:-xiaomi-call-loop-fix-v3}"

cd "$REPO_DIR"
git fetch --all
git checkout "$BRANCH"
git pull

cd ops/voice-ha

docker compose -f docker-compose.voice.yml build
docker compose -f docker-compose.voice.yml up -d --force-recreate

echo "Waiting for /health..."
for i in {1..30}; do
  if curl -fsS http://127.0.0.1:3001/health >/dev/null; then
    echo "OK"
    exit 0
  fi
  sleep 2
done

echo "Healthcheck failed"
docker logs --tail 200 superparty-voice
exit 1
