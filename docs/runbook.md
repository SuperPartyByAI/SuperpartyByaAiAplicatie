# SuperParty — RUNBOOK

## Verificări rapide ("când nu merge")

```bash
# 1. Backend live?
curl -s http://localhost:3001/status | jq .status
# Expected: "ok"

# 2. systemd service
sudo systemctl status superparty-backend
# Sau PM2:
pm2 status

# 3. Caddy
sudo systemctl status caddy
journalctl -u caddy --since "5 min ago"

# 4. Docker observability stack
docker compose -f /opt/superparty/infra/docker-compose.observability.yml ps

# 5. Grafana alerts
# Deschide: https://api.superparty.ro/grafana/ → Alerting → Alert rules

# 6. UFW (firewall)
sudo ufw status

# 7. fail2ban
sudo fail2ban-client status
```

---

## Cum vezi requestId în logs

### Din Grafana Loki

```
{service="superparty-backend"} |= "request-id-here"
```

### Din command line

```bash
# Caută în loguri locale
grep "request-id-here" /opt/superparty/logs/*.log

# Sau cu jq:
cat /opt/superparty/logs/backend.log | jq 'select(.requestId == "request-id-here")'
```

### Din Flutter (debug)

- Crashlytics: Firebase Console → Crashlytics → click pe crash → Custom Keys → `lastRequestId`

---

## Cum restaurezi din backup Firestore

```bash
# 1. Listează backup-uri
gsutil ls gs://superparty-frontend-backups/

# 2. Restaurează
gcloud firestore import gs://superparty-frontend-backups/2026-02-26_0200 \
  --project=superparty-frontend

# 3. Verifică status
gcloud firestore operations list --project=superparty-frontend
```

---

## Cum rulezi migrarea canonical JID

```bash
cd /opt/superparty/current

# DRY RUN (preview)
DRY_RUN=true node scripts/migrate-canonical-jid.js

# LIVE
DRY_RUN=false node scripts/migrate-canonical-jid.js
```

Detalii: [docs/migration-canonical-id.md](migration-canonical-id.md)

---

## Rollback deploy

### Automat (dacă health check eșuează)

GitHub Actions face rollback automat la release-ul anterior.

### Manual

```bash
ssh superparty@46.225.182.127

# Verifică
ls -la /opt/superparty/current
ls -la /opt/superparty/previous

# Rollback
ln -sfn $(readlink -f /opt/superparty/previous) /opt/superparty/current
sudo systemctl restart superparty-backend

# Verifică
curl -s http://localhost:3001/status | jq .status
```

---

## Restart servicii

```bash
# Backend
sudo systemctl restart superparty-backend

# Caddy
sudo systemctl restart caddy

# Observability stack
cd /opt/superparty/infra
docker compose -f docker-compose.observability.yml restart

# Totul
sudo systemctl restart superparty-backend caddy
docker compose -f /opt/superparty/infra/docker-compose.observability.yml restart
```

---

## Contacte & Escalare

| Componenta       | Detalii                                                         |
| ---------------- | --------------------------------------------------------------- |
| Server Hetzner   | 46.225.182.127                                                  |
| Firebase Console | https://console.firebase.google.com/project/superparty-frontend |
| Grafana          | https://api.superparty.ro/grafana/                              |
| GitHub Actions   | Repository → Actions tab                                        |
