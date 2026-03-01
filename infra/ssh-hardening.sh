#!/usr/bin/env bash
# SuperParty — SSH Hardening
# Disable root login, disable password auth, permit only key-based SSH
#
# ATENȚIE: Asigură-te că ai SSH key configurat ÎNAINTE de a rula!
#   ssh-copy-id user@server
#
# USAGE: sudo bash ssh-hardening.sh

set -euo pipefail

SSHD_CONFIG="/etc/ssh/sshd_config"
BACKUP="${SSHD_CONFIG}.backup.$(date +%Y%m%d_%H%M%S)"

echo "=== SuperParty SSH Hardening ==="
echo ""

# Backup
echo "[1/5] Backup config: ${BACKUP}"
cp "$SSHD_CONFIG" "$BACKUP"

# Disable root login
echo "[2/5] Disable root login..."
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' "$SSHD_CONFIG"

# Disable password authentication
echo "[3/5] Disable password authentication..."
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' "$SSHD_CONFIG"

# Disable empty passwords
echo "[4/5] Disable empty passwords..."
sed -i 's/^#\?PermitEmptyPasswords.*/PermitEmptyPasswords no/' "$SSHD_CONFIG"

# Only allow pubkey auth
echo "[5/5] Enable PubkeyAuthentication..."
sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' "$SSHD_CONFIG"

# Optional extras
grep -q "^MaxAuthTries" "$SSHD_CONFIG" || echo "MaxAuthTries 3" >> "$SSHD_CONFIG"
grep -q "^LoginGraceTime" "$SSHD_CONFIG" || echo "LoginGraceTime 30" >> "$SSHD_CONFIG"
grep -q "^ClientAliveInterval" "$SSHD_CONFIG" || echo "ClientAliveInterval 300" >> "$SSHD_CONFIG"
grep -q "^ClientAliveCountMax" "$SSHD_CONFIG" || echo "ClientAliveCountMax 2" >> "$SSHD_CONFIG"

# Validate config
echo ""
echo "Validating sshd config..."
sshd -t && echo "✅ Config valid!" || { echo "❌ Config INVALID! Restoring backup..."; cp "$BACKUP" "$SSHD_CONFIG"; exit 1; }

# Restart SSH
echo ""
echo "Restarting sshd..."
systemctl restart sshd

echo ""
echo "=== SSH Hardening Complete ==="
echo "  PermitRootLogin: no"
echo "  PasswordAuthentication: no"
echo "  PubkeyAuthentication: yes"
echo "  MaxAuthTries: 3"
echo ""
echo "⚠️  Testează IMEDIAT o conexiune nouă SSH înainte de a închide sesiunea curentă!"
