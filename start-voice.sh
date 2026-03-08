#!/bin/bash
# start-voice.sh — Pornire superparty-voice Docker container
# ÎN PRODUCȚIE: rulează din /root pe VPS
#
# ⚠️  IMPORTANT: .env TREBUIE să conțină TWILIO_AUTH_TOKEN (nu TWILIO_TOKEN)
#     și TWIML_APP_SID (nu TWILIO_TWIML_APP_SID).
#
set -e

ENV_FILE="${1:-/opt/superparty-ai/repo/server/voice-service/.env}"

echo "[start-voice] Verificare .env: $ENV_FILE"
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ .env nu există: $ENV_FILE"
  exit 1
fi

# Validare variabile critice
MISSING=""
for VAR in TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_API_KEY_SID TWILIO_API_KEY_SECRET TWIML_APP_SID JWT_SECRET SUPABASE_URL; do
  if ! grep -q "^${VAR}=" "$ENV_FILE"; then
    MISSING="$MISSING $VAR"
  fi
done

# Detecteaza greseala clasica TWILIO_TOKEN in loc de TWILIO_AUTH_TOKEN
if grep -q "^TWILIO_TOKEN=" "$ENV_FILE" && ! grep -q "^TWILIO_AUTH_TOKEN=" "$ENV_FILE"; then
  echo "❌ EROARE: .env contine TWILIO_TOKEN in loc de TWILIO_AUTH_TOKEN!"
  echo "   Containerul va returna twilio_not_configured."
  exit 1
fi

if [ -n "$MISSING" ]; then
  echo "❌ Variabile lipsă din .env:$MISSING"
  exit 1
fi

echo "[start-voice] .env valid ✅"
echo "[start-voice] Oprire container vechi..."
cd /opt/superparty-ai/repo/server/voice-service
docker compose down || true

echo "[start-voice] Pornire container nou cu env-file complet și rețea Redis din Compose..."
docker compose up -d --force-recreate

sleep 5
echo "[start-voice] Health check intern..."
HEALTH=$(curl -s http://localhost:3001/health)
echo "$HEALTH"

if echo "$HEALTH" | grep -q '"ok"'; then
  echo "[start-voice] ✅ superparty-voice pornit corect"
else
  echo "[start-voice] ❌ Health check eșuat"
  exit 1
fi
