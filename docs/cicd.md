# CI/CD — GitHub Actions Deploy

## Workflow: `deploy-hetzner.yml`

### Flow

1. **Lint** — ESLint pe `whatsapp-integration-v6-index.js`
2. **Test** — `npm test` (Jest)
3. **Deploy** — rsync fișiere pe server, `npm ci --omit=dev`
4. **Symlink switch** — `/opt/superparty/current` → new release, `/opt/superparty/previous` → old
5. **Restart** — `systemctl restart superparty-backend` (sau PM2 fallback)
6. **Health check** — 5 încercări pe `http://localhost:3001/status`
7. **Rollback** — automat dacă health check eșuează

### Trigger

- Push pe `main` + fișiere modificate în `server/`
- `workflow_dispatch` (manual din GitHub UI)

---

## Secrete GitHub (Settings → Secrets → Actions)

| Secret            | Descriere                                       |
| ----------------- | ----------------------------------------------- |
| `SSH_PRIVATE_KEY` | Cheia SSH privată pentru deploy                 |
| `DEPLOY_HOST`     | IP-ul serverului Hetzner (ex: `46.225.182.127`) |
| `DEPLOY_USER`     | Userul SSH (ex: `superparty`)                   |
| `DOMAIN`          | Domeniu (opțional, ex: `api.superparty.ro`)     |

## Rollback manual

```bash
# Pe server
ssh superparty@46.225.182.127

# Vezi release-urile
ls -la /opt/superparty/releases/
ls -la /opt/superparty/current
ls -la /opt/superparty/previous

# Rollback la previous
ln -sfn $(readlink -f /opt/superparty/previous) /opt/superparty/current
sudo systemctl restart superparty-backend

# Verifică
curl -s http://localhost:3001/status | jq .status
```

## Deploy manual (fără CI)

```bash
# De pe mașina locală
rsync -avz --exclude='node_modules' --exclude='.git' --exclude='.env' \
  server/ superparty@46.225.182.127:/opt/superparty/current/

ssh superparty@46.225.182.127 "cd /opt/superparty/current && npm ci --omit=dev && sudo systemctl restart superparty-backend"
```
