# Deploy Backend pe Hetzner

## Status curent

**Hetzner rulează versiune veche** - `/health` nu include `database` în răspuns.

**Codul local** (commit `be6a9ade` pe branch `fix/whatsapp-improvements-20260127`) include:
- `database: databaseAvailable && db ? 'connected' : 'disabled'` în `/health` (linia 7124)
- Status Database în răspunsul `/health` pentru diagnosticare

## Deploy pe Hetzner

### 1. Conectează-te la Hetzner

```bash
ssh root@37.27.34.179
```

### 2. Navighează la directorul backend

```bash
cd /opt/whatsapp/Aplicatie-SuperpartyByAi/whatsapp-backend
# SAU (dacă e alt path)
cd ~/Aplicatie-SuperpartyByAi/whatsapp-backend
```

### 3. Pull latest code

```bash
# Verifică branch-ul curent
git branch

# Pull de pe branch-ul corect (sau main/master după merge)
git pull origin fix/whatsapp-improvements-20260127
# SAU (după merge în main)
git pull origin main
```

### 4. Install dependencies

```bash
npm ci
```

### 5. Restart service

```bash
sudo systemctl restart whatsapp-backend
# SAU (dacă e alt nume de serviciu)
sudo systemctl restart whatsapp
```

### 6. Verifică deploy

Așteaptă ~10-30 secunde, apoi verifică:

```bash
# Verifică status serviciu
sudo systemctl status whatsapp-backend

# Verifică logs
sudo journalctl -u whatsapp-backend -f --lines 50

# Verifică /health include database
curl -s http://localhost:8080/health | jq .database
# SAU
curl -s http://37.27.34.179:8080/health | jq .database
```

**Așteptat după deploy:**
- `"database": "connected"` (dacă SUPABASE_SERVICE_ACCOUNT_JSON e setat)
- `"database": "disabled"` (dacă nu e setat)

**Dacă încă nu apare `database` în răspuns:**
- Backend-ul nu s-a restartat cu noul cod
- Verifică logs pentru erori la start
- Verifică că ai pull-at branch-ul corect

## Verificare rapidă (din local)

După deploy, rulează:

```bash
curl -s http://37.27.34.179:8080/health | jq '{database, version, commit}'
```

**Așteptat:**
```json
{
  "database": "connected",  // sau "disabled"
  "version": "2.0.0",
  "commit": "be6a9ade"  // sau hash-ul commit-ului deploy-at
}
```

## Troubleshooting

### Backend nu pornește după restart

```bash
# Verifică erori
sudo journalctl -u whatsapp-backend -n 100 --no-pager

# Verifică dacă port-ul e ocupat
sudo lsof -i :8080

# Verifică env vars
sudo systemctl show whatsapp-backend | grep Environment
```

### Database rămâne "disabled" după deploy

1. Verifică că `SUPABASE_SERVICE_ACCOUNT_JSON` e setat:
   ```bash
   sudo systemctl show whatsapp-backend | grep SUPABASE
   ```

2. Verifică logs pentru erori de inițializare Supabase:
   ```bash
   sudo journalctl -u whatsapp-backend | grep -i "supabase\|database"
   ```

3. Dacă lipsește, setează env var și restart:
   ```bash
   # Editează service file
   sudo systemctl edit whatsapp-backend
   # Adaugă:
   [Service]
   Environment="SUPABASE_SERVICE_ACCOUNT_JSON=..."
   ```

## Note

- Build time: ~1-2 minute (npm ci)
- Restart time: ~10-30 secunde
- Total: ~2-3 minute

După deploy, `/health` ar trebui să includă `database` pentru diagnosticare rapidă a problemelor de inbox clienți.
