# Cum Verificăm Stabilitatea Sesiunii Baileys

## Verificare Rapidă (2 minute)

### 1. Verifică backend health:

```bash
curl -s https://whats-app-ompro.ro/health | jq
```

**Rezultat OK:**
- `"status": "healthy"`
- `"ok": true`
- Uptime > 0

### 2. Verifică accounts status:

```bash
export ADMIN_TOKEN=your-token
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://whats-app-ompro.ro/api/whatsapp/accounts | jq
```

**Rezultat OK:**
- Status: `"connected"` (nu `"qr_ready"` constant)
- NU apare `"needs_qr"` frecvent
- QR code: doar pentru account-uri noi (nu regenerate constant)

### 3. Verifică logurile pentru restores:

**Opțiunea 1: legacy hosting Dashboard (recomandat)**
- Deschide: https://legacy hosting.app/project
- Selectează proiectul "Whats Upp"
- Click pe service → Logs
- Caută: `restore.*Database` sau `Session restored`

**Opțiunea 2: legacy hosting CLI (dacă e linkat)**
```bash
# Link proiectul mai întâi:
cd whatsapp-backend
legacy hosting link

# Apoi verifică logurile:
legacy hosting logs | grep -i "restore.*Database\|Session restored" | tail -20
```

**Rezultat OK:**
- Apare `"Session restored from Database"` doar la redeploy/crash
- NU apare frecvent (dacă apare constant = problemă)

---

## Verificare Stabilitate (30 minute)

### Test 1: Simulează redeploy

**Pas 1:** Monitorează logurile (legacy hosting Dashboard):
- Deschide: https://legacy hosting.app/project
- Selectează "Whats Upp" → Service → Logs
- SAU: `legacy hosting logs` (dacă e linkat)

**Pas 2:** Redeploy backend (legacy hosting Dashboard):
- Click pe service → Deployments → Redeploy
- SAU: `legacy hosting up` (dacă e linkat din whatsapp-backend/)

**Pas 3:** Verifică restore în loguri:
- În legacy hosting Dashboard → Logs
- SAU: `legacy hosting logs | grep -i "restore.*Database" | tail -10`

**✅ SUCCESS dacă:**
- Apare `"🔄 [account_xxx] Disk session missing, attempting Database restore..."`
- Apare `"✅ [account_xxx] Session restored from Database (X files)"`
- Accounts rămân `"connected"` (NU trebuie QR nou)

---

## Indicatori de Stabilitate

### ✅ BUN (ca WhatsApp normal):
- Status `"connected"` pentru account-uri active
- Restore count < 5/zi (normal pentru network issues minore)
- NU apare `"needs_qr"` des (doar la logout real)
- Health `"healthy"` constant

### ❌ PROBLEMĂ (necesită investigare):
- Status `"needs_qr"` frecvent → sesiunea se pierde des
- Restore count > 20/zi → sesiunea se corupe des
- Health `"unhealthy"` → backend-ul e instabil

---

## Comandă Simplă pentru Verificare

```bash
# 1. Health
echo "Health:" && curl -s https://whats-app-ompro.ro/health | jq -r '.status'

# 2. Accounts (dacă ai token)
export ADMIN_TOKEN=your-token
echo "Accounts:" && curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://whats-app-ompro.ro/api/whatsapp/accounts | \
  jq -r '.accounts[] | "\(.name // .id): \(.status)"'

# 3. Recent restores (ultima oră)
# Opțiunea 1: legacy hosting Dashboard → Logs → Search "restore"
# Opțiunea 2: legacy hosting CLI (dacă e linkat)
echo "Recent restores:" && legacy hosting logs | \
  grep -c "restore.*Database" || echo "None (good - session stable)"
```

