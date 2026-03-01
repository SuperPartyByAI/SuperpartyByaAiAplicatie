# Server Setup — Hetzner VPS

## Cerințe

- Ubuntu 22.04/24.04 LTS
- Docker + Docker Compose instalat
- Node.js 20 LTS
- domeniu DNS pointing la IP-ul serverului (pentru HTTPS)

---

## 1. User & Permisiuni

```bash
# Creează user dedicat
sudo adduser superparty --disabled-password
sudo mkdir -p /opt/superparty/{current,releases,logs}
sudo chown -R superparty:superparty /opt/superparty
```

## 2. Caddy (Reverse Proxy + HTTPS)

```bash
# Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy

# Copy config
sudo cp infra/Caddyfile /etc/caddy/Caddyfile
# Editează domeniul:
sudo nano /etc/caddy/Caddyfile

sudo systemctl enable caddy
sudo systemctl start caddy
```

## 3. systemd Service

```bash
sudo cp infra/superparty-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable superparty-backend
sudo systemctl start superparty-backend
```

## 4. UFW Firewall

```bash
sudo bash infra/ufw-setup.sh
```

## 5. fail2ban

```bash
sudo apt install -y fail2ban
sudo cp infra/fail2ban-superparty.conf /etc/fail2ban/jail.d/superparty.conf
sudo cp infra/fail2ban-caddy-auth.conf /etc/fail2ban/filter.d/caddy-auth.conf
sudo cp infra/fail2ban-caddy-4xx.conf /etc/fail2ban/filter.d/caddy-4xx.conf
sudo systemctl restart fail2ban
sudo fail2ban-client status
```

## 6. SSH Hardening

```bash
# ATENȚIE: Asigură-te că ai SSH key înainte!
sudo bash infra/ssh-hardening.sh
# Testează o conexiune nouă ÎNAINTE de a închide sesiunea curentă!
```

## 7. Docker (pentru observabilitate)

```bash
# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker superparty

# Start observability stack
cd /opt/superparty/infra
docker compose -f docker-compose.observability.yml up -d
```

---

## Verificări Post-Setup

```bash
# Backend
sudo systemctl status superparty-backend
curl -s http://localhost:3001/status | jq .status

# Caddy
sudo systemctl status caddy
curl -I https://api.superparty.ro/  # Verifică HSTS header

# UFW
sudo ufw status verbose

# fail2ban
sudo fail2ban-client status sshd

# Docker observability
docker compose -f docker-compose.observability.yml ps

# Grafana
curl -s http://localhost:3000/api/health
```

---

## Troubleshooting

| Problemă                  | Verificare                                      |
| ------------------------- | ----------------------------------------------- |
| Backend nu pornește       | `journalctl -u superparty-backend -f`           |
| Caddy eroare HTTPS        | `journalctl -u caddy -f` — verifică DNS         |
| Port blocat               | `sudo ufw status`                               |
| Ban accidental (fail2ban) | `sudo fail2ban-client set sshd unbanip YOUR_IP` |
