# RUNBOOK — Superparty AI Manager

## Overview

The AI Manager is the control plane for all AI-driven employee operations.  
It runs as a separate service on `superparty-ai-01` (Hetzner CCX43).

- **Port**: 3002
- **URL (internal)**: `http://superparty-ai-01:3002`
- **URL (public)**: `https://ai.superparty.ro` (via Caddy/nginx reverse proxy)
- **User**: `aiops` (non-root)
- **Working dir**: `/opt/superparty-ai`

---

## Hetzner Server Setup (Manual Steps)

### 1. Order Server

- Provider: **Hetzner Cloud**
- Plan: **CCX43** (if unavailable → CCX53, never smaller than CCX43)
- OS: **Ubuntu 22.04 LTS**
- Location: EU (Frankfurt or Helsinki)
- Name: `superparty-ai-01`

After ordering, note the IP address.

### 2. Initial Setup (as root)

```bash
# Update system
apt-get update && apt-get upgrade -y

# Create admin user
adduser aiops
usermod -aG sudo aiops

# Copy your SSH key to aiops
mkdir -p /home/aiops/.ssh
cat /root/.ssh/authorized_keys >> /home/aiops/.ssh/authorized_keys
chown -R aiops:aiops /home/aiops/.ssh
chmod 700 /home/aiops/.ssh
chmod 600 /home/aiops/.ssh/authorized_keys
```

### 3. SSH Hardening

Edit `/etc/ssh/sshd_config`:

```
PasswordAuthentication no
PermitRootLogin no
ChallengeResponseAuthentication no
MaxAuthTries 3
```

Then: `systemctl restart sshd`

### 4. Firewall (UFW)

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 443/tcp
ufw allow 3002/tcp comment "AI Manager"
ufw enable
```

### 5. fail2ban

```bash
apt-get install -y fail2ban
cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
# Edit jail.local: set bantime=3600, findtime=600, maxretry=5
systemctl enable fail2ban && systemctl start fail2ban
```

### 6. Docker + Compose

```bash
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker aiops
```

### 7. Folder Structure

```bash
mkdir -p /opt/superparty-ai/{config,data,logs,workflows}
chown -R aiops:aiops /opt/superparty-ai
```

### 8. Deploy Config

```bash
# As aiops user:
cp /path/to/repo/server/ai-manager/.env.example /opt/superparty-ai/config/.env
# Fill in real values in /opt/superparty-ai/config/.env
```

---

## Deploy AI Manager

```bash
# As aiops on superparty-ai-01:
cd /opt/superparty-ai

# Clone / pull repo
git clone https://github.com/SuperPartyByAI/SuperpartyByaAiAplicatie.git repo
# or: cd repo && git pull origin main

# Build and start
cd repo/server/ai-manager
docker compose up -d --build

# Verify
curl http://localhost:3002/health
```

---

## Run SQL Migrations

Run each migration in order in **Supabase SQL Editor** (Production project):

```
server/ai-manager/migrations/001_ai_events.sql
server/ai-manager/migrations/002_ai_audit_log.sql
server/ai-manager/migrations/003_ai_contestations.sql
server/ai-manager/migrations/004_gps_trips.sql
server/ai-manager/migrations/005_media_jobs.sql
```

All migrations use `CREATE TABLE IF NOT EXISTS` — safe to rerun.

---

## Operations

### Check health

```bash
curl https://ai.superparty.ro/health
```

### Test analyze-event

```bash
curl -X POST https://ai.superparty.ro/ai/analyze-event \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AI_ADMIN_TOKEN" \
  -d '{
    "source": "whatsapp",
    "conversationId": "TEST-001",
    "messageText": "Buna ziua! As vrea sa rezerv un animatori pentru o petrecere pe 20 aprilie, pentru 30 de copii."
  }'
```

### View logs

```bash
docker compose logs -f ai-manager
# or:
tail -f /opt/superparty-ai/logs/*.log
```

### Restart

```bash
docker compose restart ai-manager
```

### Check Prometheus metrics

```bash
curl http://localhost:3002/metrics
```

---

## Monitoring

- `/health` — liveness (Caddy/nginx upstream check)
- `/metrics` — Prometheus scrape endpoint
- Key metrics:
  - `ai_manager_analyze_event_total{status="success"}` — successful AI analyses
  - `ai_manager_analyze_event_total{status="error"}` — failed analyses
  - `ai_manager_active_trips` — active employee trips

---

## Backup Notes

- **Code**: git repo is source of truth
- **Supabase data**: backed up via Supabase dashboard (daily auto-backup on Pro plan)
- **Redis data**: `/opt/superparty-ai/data/redis/` — AOF persistence enabled
- **Config**: `/opt/superparty-ai/config/.env` — back up separately (NOT in git)

---

## Escalation

If AI Manager is down:

1. WhatsApp and Voice continue normally — they are independent
2. Restart AI Manager: `docker compose restart ai-manager`
3. Check logs: `docker compose logs ai-manager --tail 100`
4. If DB connection fails: verify Supabase secrets in `/opt/superparty-ai/config/.env`
