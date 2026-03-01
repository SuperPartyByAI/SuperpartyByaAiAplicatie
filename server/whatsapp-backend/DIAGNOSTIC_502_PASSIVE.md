# 🔍 Diagnostic: Backend 502 → PASSIVE Mode

## ✅ Status Actual

**Backend PORNESTE CORECT:**
- ✅ Server running on port 8080
- ✅ ADMIN_TOKEN configured
- ✅ SUPABASE_SERVICE_ACCOUNT_JSON setat
- ✅ SESSIONS_PATH=/app/sessions
- ✅ Health endpoint: 200 OK

## ❌ Probleme Identificate

### 1. `/ready` endpoint returnează 404

**Cauză:**
- Endpoint `/ready` nu există în versiunea deployed
- Commit deployed: `d4f4998a` (versiune mai veche)
- Codul local are `/ready` la linia 2148, dar nu e deployed

**Răspuns:**
```html
<!DOCTYPE html>
<html>
<body>
<pre>Cannot GET /ready</pre>
</body>
</html>
```

**jq error:** Normal - răspunsul e HTML (404), nu JSON.

---

### 2. Backend în PASSIVE Mode

**Din logs:**
```
[WALock] ❌ Not acquired - held by 3a8e0c47-3d2a-4777-a0cb-fba99279432f (expires in 57s)
[WABootstrap] ⚠️ PASSIVE MODE - lock_not_acquired
[WABootstrap] Will NOT start Baileys connections
[WABootstrap] Will NOT process outbox
```

**Cauză:**
- **Existență de DOUĂ instanțe backend** rulate simultan
- Instance curentă: `40fa3479-c4af-4ec6-9ff4-39c88cc3efb6`
- Lock holder (ACTIVE): `3a8e0c47-3d2a-4777-a0cb-fba99279432f` (altă instanță)
- Doar una poate fi ACTIVE la un moment dat (previne conflicts)

**Efect:**
- ❌ Baileys connections NU pornesc
- ❌ Outbox processing NU funcționează
- ❌ Inbound messages NU sunt procesate
- ✅ Accounts pot fi văzute dar nu sunt funcționale

---

## 🔧 Soluție

### Pasul 1: Verifică Instanțe Multiple pe Hetzner

1. **SSH la server**:
   ```bash
   ssh root@37.27.34.179
   ```

2. **Verifică procese Node.js**:
   ```bash
   ps aux | grep "node.*server.js" | grep -v grep
   ```

3. **Verifică systemd service**:
   ```bash
   sudo systemctl status whatsapp-backend
   ```

**Dacă există multiple instanțe:**
- Oprește procesele duplicate
- Asigură-te că doar systemd service rulează

### Pasul 2: Verifică Systemd Service

```bash
ssh root@37.27.34.179
sudo systemctl status whatsapp-backend
```

**Verifică:**
- Doar un proces activ
- Service status: `active (running)`

**Dacă există probleme:**
- Restart service: `sudo systemctl restart whatsapp-backend`
- Verifică logs: `sudo journalctl -u whatsapp-backend -n 100`

### Pasul 3: Restart Service pentru o singură instanță

**SSH și restart:**
1. SSH: `ssh root@37.27.34.179`
2. Restart: `sudo systemctl restart whatsapp-backend`
3. Așteaptă să se termine
4. Verifică că doar o instanță e activă

### Pasul 4: Verificare după restart

**Verifică logs:**
```bash
ssh root@37.27.34.179
sudo journalctl -u whatsapp-backend -n 50 | grep -E "mode=|PASSIVE|ACTIVE|lock"
```

**Așteptat (ACTIVE):**
```
[WABootstrap] WA system initialized: mode=active
[WABootstrap] Will start Baileys connections
```

**Așteptat (PASSIVE dacă încă e problema):**
```
[WALock] ❌ Not acquired - held by <another-instance>
[WABootstrap] ⚠️ PASSIVE MODE
```

**Verifică health:**
```bash
curl -s https://whats-app-ompro.ro/health | jq '{mode, waMode, lock}'
```

---

## 📊 Verificare Variabile Critice

**Variabilele sunt setate corect:**
- ✅ `ADMIN_TOKEN` = `8df59afe1ca9387674e2b72c42460e3a3d2dea96833af6d3d9b840ff48ddfea3`
- ✅ `SUPABASE_SERVICE_ACCOUNT_JSON` = setat
- ✅ `SESSIONS_PATH` = `/app/sessions`

**Nu e problemă cu variabilele!**

---

## 🎯 Rezumat

1. **Backend PORNESTE** ✅ (nu mai e 502)
2. **Variabile setate corect** ✅
3. **PASSIVE mode** ❌ - lock held by another instance
4. **`/ready` endpoint** ❌ - nu există în versiunea deployed (404)

**Fix minim:**
- Asigură-te că ai **o singură instanță backend** pe Hetzner
- Oprește procesele duplicate
- Restart service pentru a deveni ACTIVE

**După fix:**
- Backend va deveni ACTIVE
- Baileys connections vor porni
- Accounts vor funcționa corect
- Aplicația va arăta conturi

---

**Pentru a verifica după fix:**
```bash
# Verifică mode
curl -s https://whats-app-ompro.ro/health | jq '{mode, waMode, lock}'

# Verifică logs
ssh root@37.27.34.179
sudo journalctl -u whatsapp-backend -n 50 | grep -E "mode=|ACTIVE|PASSIVE"
```

**Dacă vezi `mode: "active"` sau `waMode: "active"` → ✅ Problema rezolvată!**
