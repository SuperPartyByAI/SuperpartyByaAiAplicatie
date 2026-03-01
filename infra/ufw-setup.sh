#!/usr/bin/env bash
# SuperParty — UFW Firewall Setup
# Permite doar SSH (22), HTTP (80), HTTPS (443)
# Rulează ca root pe Hetzner VPS
#
# USAGE: sudo bash ufw-setup.sh

set -euo pipefail

echo "=== SuperParty UFW Setup ==="

# Reset dacă e necesar
# ufw --force reset

# Default: deny incoming, allow outgoing
ufw default deny incoming
ufw default allow outgoing

# SSH — OBLIGATORIU înainte de enable!
ufw allow 22/tcp comment "SSH"

# HTTP + HTTPS (Caddy)
ufw allow 80/tcp comment "HTTP (Caddy redirect)"
ufw allow 443/tcp comment "HTTPS (Caddy)"

# NU expunem:
# - 3001 (backend) — accesat doar prin Caddy reverse proxy
# - 3000 (Grafana) — accesat doar prin Caddy reverse proxy
# - 9090 (Prometheus) — doar localhost
# - 9100 (node_exporter) — doar localhost
# - 3100 (Loki) — doar localhost

# Enable
ufw --force enable

# Status
ufw status verbose

echo ""
echo "=== UFW configurat cu succes ==="
echo "Porturi deschise: 22 (SSH), 80 (HTTP), 443 (HTTPS)"
echo "Toate celelalte porturi sunt blocate din exterior"
