#!/usr/bin/env bash
set -euo pipefail

# Usage: ./set_groq_key.sh [user@host] [ssh_key_path]
HOST="${1:-root@37.27.34.179}"
KEY_PATH="${2:-$HOME/.ssh/hetzner_whatsapp}"
ENV_FILE="/etc/whatsapp-backend/supabase-sa.env"
GROQ_API_KEY="gsk_YOUR_GROQ_API_KEY_HERE"

echo "🔑 Setting GROQ_API_KEY on $HOST..."

# Detect service
detect_service() {
  ssh -i "$KEY_PATH" "$HOST" \
    "systemctl list-units --type=service --no-legend | awk '{print \$1}' | grep -E '^(whatsapp-backend\\.service|whatsapp_backend\\.service|superparty-backend\\.service)$' | head -n 1" \
    || true
}

SERVICE="$(detect_service)"
if [[ -z "${SERVICE:-}" ]]; then
  echo "❌ Nu am putut detecta automat service-ul."
  echo "Rulează pe server: systemctl list-units --type=service | grep -i whatsapp"
  exit 1
fi

echo "✅ Service detectat: $SERVICE"

# Ensure env file exists and preserve existing content
echo "📝 Updating environment file..."
ssh -i "$KEY_PATH" "$HOST" <<'EOF'
set -e
ENV_FILE="/etc/whatsapp-backend/supabase-sa.env"
sudo mkdir -p /etc/whatsapp-backend

# Backup existing file if it exists
if [ -f "$ENV_FILE" ]; then
  sudo cp "$ENV_FILE" "${ENV_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
fi

# Read existing content (if any) and add/update GROQ_API_KEY
if [ -f "$ENV_FILE" ]; then
  # Remove old GROQ_API_KEY line if exists, then add new one
  sudo sed -i.bak '/^GROQ_API_KEY=/d' "$ENV_FILE" || true
fi

# Add GROQ_API_KEY
echo "GROQ_API_KEY=gsk_YOUR_GROQ_API_KEY_HERE" | sudo tee -a "$ENV_FILE" > /dev/null

# Set proper permissions
sudo chmod 600 "$ENV_FILE"
sudo chown root:root "$ENV_FILE"

echo "✅ Environment file updated"
EOF

# Restart service
echo "🔄 Restarting service..."
ssh -i "$KEY_PATH" "$HOST" \
  "sudo systemctl daemon-reload && sudo systemctl restart '$SERVICE' && sudo systemctl is-active --quiet '$SERVICE' && echo '✅ Service restarted successfully' || echo '❌ Service restart failed'"

# Show recent logs
echo ""
echo "📋 Recent logs:"
ssh -i "$KEY_PATH" "$HOST" \
  "sudo journalctl -u '$SERVICE' -n 20 --no-pager | tail -10"

echo ""
echo "✅ Done! GROQ_API_KEY has been set."
echo "💡 Check logs above to verify the service is running correctly."
