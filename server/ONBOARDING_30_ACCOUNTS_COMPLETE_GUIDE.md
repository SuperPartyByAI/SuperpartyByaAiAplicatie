# 🚀 Onboarding 30 WhatsApp Accounts - Ghid Complet cu Comenzi cURL

**Base URL:** `https://your-service.legacy hosting.app` (înlocuiește cu domeniul tău legacy hosting)  
**Admin Token:** Setează `ADMIN_TOKEN` în legacy hosting Variables

---

## Setup Variabile (Pentru Scripts)

```bash
# Setează aceste variabile înainte de a rula comenzi
export BASE_URL="https://whats-app-ompro.ro"  # Înlocuiește cu URL-ul tău
export ADMIN_TOKEN="your-admin-token-here"  # Din legacy hosting Variables
```

---

## Checklist Complet: legacy hosting + Onboarding 30 Conturi

### ✅ 1. legacy hosting Setup (Cap-coadă)

#### A. Persistent Volume

**În legacy hosting Dashboard:**
1. legacy hosting → Project → Service (`whatsapp-backend`) → Tab **"Volumes"**
2. Click **"New Volume"**
3. Completează:
   - **Name:** `whatsapp-sessions-volume`
   - **Mount Path:** `/app/sessions` ⚠️ (EXACT - confirmat în `legacy hosting.toml` linia 17)
   - **Size:** `10GB` (recomandat pentru 30 conturi)
4. Click **"Create"**
5. Așteaptă status **"Active"** (verde)

#### B. Variabile de Mediu (Minim Necesare)

**În legacy hosting Dashboard:**
1. legacy hosting → Service → Tab **"Variables"**
2. Adaugă variabilele:

```bash
# CRITICAL - Must match volume mount path
SESSIONS_PATH=/app/sessions

# CRITICAL - Supabase service account JSON (ca string)
SUPABASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...",...}

# RECOMMENDED - Admin token pentru endpoint-uri protejate
ADMIN_TOKEN=your-long-random-secret-token-here

# OPTIONAL - Timeout pentru conexiune WhatsApp
WHATSAPP_CONNECT_TIMEOUT_MS=60000
```

#### C. Verificări în Logs după Deploy

**Comandă:**
```bash
# Obține logs recente (după deploy)
legacy hosting logs --tail 100
# Sau în legacy hosting Dashboard → Deployments → Latest → View Logs
```

**Caută în logs:**
```
✅ Sessions dir writable: true
✅ SESSIONS_PATH: /app/sessions
✅ Supabase Admin initialized
✅ Server running on port 8080
```

**Test Health Endpoint:**
```bash
curl -s "https://your-service.legacy hosting.app/health" | jq '{ok, sessions_dir_writable, status, database}'
```

**Așteptat:**
```json
{
  "ok": true,
  "sessions_dir_writable": true,
  "status": "healthy",
  "database": {
    "status": "connected"
  }
}
```

---

## 2. Onboarding 30 Conturi - Flow Complet

### A. Adaugă Cont (Exemplu pentru 1 cont)

**Endpoint:** `POST /api/whatsapp/add-account`

**Comandă cURL:**
```bash
curl -sS -X POST "${BASE_URL}/api/whatsapp/add-account" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "WA-01",
    "phone": "+40712345678"
  }' | jq .
```

**Response Exemplu:**
```json
{
  "success": true,
  "account": {
    "id": "account_prod_abc123def456...",
    "name": "WA-01",
    "phone": "+40712345678",
    "status": "connecting",
    "qrCode": null,
    "pairingCode": null,
    "createdAt": "2026-01-17T18:30:00.000Z"
  }
}
```

**Note:**
- `accountId` este generat determinist din `phone` (hash SHA256) → format `account_{env}_{hash}`
- Nu este `WA-01` literal, ci `account_prod_abc123...`
- Limita maximă: **30 conturi** (validat în cod linia 139)

---

### B. Obține QR Code

**Metoda 1: HTML Page (Recomandat pentru scanare)**
```bash
# Deschide în browser sau folosește pentru scanare
open "${BASE_URL}/api/whatsapp/qr/{accountId}"

# Sau copiază URL-ul și deschide-l manual
echo "${BASE_URL}/api/whatsapp/qr/{accountId}"
```

**Metoda 2: JSON Response (Pentru integrare)**
```bash
# Listează toate conturile (inclusiv QR-uri)
curl -sS "${BASE_URL}/api/whatsapp/accounts" | jq '.accounts[] | select(.status == "qr_ready") | {id, name, qrCode}'
```

**Response Exemplu:**
```json
{
  "success": true,
  "accounts": [
    {
      "id": "account_prod_abc123...",
      "name": "WA-01",
      "status": "qr_ready",
      "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
    }
  ]
}
```

**Extrage QR Code pentru un cont specific:**
```bash
# Salvează QR code ca PNG
ACCOUNT_ID="account_prod_abc123..."
curl -sS "${BASE_URL}/api/whatsapp/accounts" | \
  jq -r ".accounts[] | select(.id == \"${ACCOUNT_ID}\") | .qrCode" | \
  sed 's/data:image\/png;base64,//' | \
  base64 -d > qr-${ACCOUNT_ID}.png

# Deschide imaginea
open qr-${ACCOUNT_ID}.png
```

---

### C. Confirmă Status CONNECTED

**Endpoint 1: Dashboard (Recomandat)**
```bash
curl -sS "${BASE_URL}/api/status/dashboard" | jq '{timestamp, summary, accounts: [.accounts[] | {accountId, status, phone}]}'
```

**Response Exemplu:**
```json
{
  "timestamp": "2026-01-17T18:35:00.000Z",
  "summary": {
    "connected": 1,
    "connecting": 0,
    "disconnected": 0,
    "needs_qr": 0,
    "total": 1
  },
  "accounts": [
    {
      "accountId": "account_prod_abc123...",
      "status": "connected",
      "phone": "+407****78"
    }
  ]
}
```

**Endpoint 2: Lista Conturi**
```bash
curl -sS "${BASE_URL}/api/whatsapp/accounts" | jq '.accounts[] | {id, name, status, phone}'
```

**Verificare Rapidă (Script):**
```bash
# Verifică dacă toate conturile sunt connected
curl -sS "${BASE_URL}/api/status/dashboard" | \
  jq -e '.summary.connected == .summary.total' && \
  echo "✅ All accounts connected" || \
  echo "❌ Some accounts not connected"
```

---

### D. Dacă Cont Devine loggedOut / needs_qr

#### Opțiunea 1: Regenerare QR (Repair Standard)

**Endpoint:** `POST /api/whatsapp/regenerate-qr/:accountId`

```bash
ACCOUNT_ID="account_prod_abc123..."
curl -sS -X POST "${BASE_URL}/api/whatsapp/regenerate-qr/${ACCOUNT_ID}" | jq .
```

**Response:**
```json
{
  "success": true,
  "message": "QR regeneration started"
}
```

**Apoi repeți pașii B-C:**
1. Aștepți 5-10 secunde
2. Obții QR nou: `GET /api/whatsapp/qr/${ACCOUNT_ID}`
3. Scanezi cu telefonul
4. Verifici status: `GET /api/status/dashboard`

#### Opțiunea 2: Reset Hard (DELETE + Re-add)

**Pas 1: Șterge Contul**
```bash
curl -sS -X DELETE "${BASE_URL}/api/whatsapp/accounts/${ACCOUNT_ID}" | jq .
```

**Response:**
```json
{
  "success": true,
  "message": "Account deleted"
}
```

**Pas 2: Re-add Contul**
```bash
# Repetă pasul A (POST /api/whatsapp/add-account)
curl -sS -X POST "${BASE_URL}/api/whatsapp/add-account" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "WA-01",
    "phone": "+40712345678"
  }' | jq .
```

---

### E. Onboarding pentru 30 Conturi (Procedură Completă)

#### Script Bash Complet pentru 30 Conturi

**Script: `onboard-30-accounts.sh`**
```bash
#!/bin/bash

# Configurare
BASE_URL="${BASE_URL:-https://whats-app-ompro.ro}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"

# Lista de telefonuri (adaugă 30 numere aici)
PHONES=(
  "+40711111111"
  "+40722222222"
  "+40733333333"
  # ... adaugă până la 30
)

echo "🚀 Onboarding 30 WhatsApp Accounts"
echo "==================================="
echo ""

# Funcție helper: obține accountId din response
get_account_id() {
  local response="$1"
  echo "$response" | jq -r '.account.id // empty'
}

# Funcție helper: așteaptă până status devine "qr_ready" sau "connected"
wait_for_status() {
  local account_id="$1"
  local target_status="$2"
  local max_wait=30
  local waited=0
  
  while [ $waited -lt $max_wait ]; do
    status=$(curl -sS "${BASE_URL}/api/whatsapp/accounts" | \
      jq -r ".accounts[] | select(.id == \"${account_id}\") | .status")
    
    if [ "$status" == "$target_status" ]; then
      return 0
    fi
    
    sleep 2
    waited=$((waited + 2))
  done
  
  return 1
}

# Pas 1: Adaugă toate conturile
echo "📝 Pas 1: Adăugare 30 conturi..."
ACCOUNT_IDS=()

for i in "${!PHONES[@]}"; do
  phone="${PHONES[$i]}"
  name="WA-$((i+1))"
  
  echo "  Adding account $((i+1))/30: $name ($phone)..."
  
  response=$(curl -sS -X POST "${BASE_URL}/api/whatsapp/add-account" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"${name}\",\"phone\":\"${phone}\"}")
  
  account_id=$(get_account_id "$response")
  
  if [ -n "$account_id" ]; then
    ACCOUNT_IDS+=("$account_id")
    echo "    ✅ Account ID: $account_id"
  else
    echo "    ❌ Failed: $response"
  fi
  
  # Jitter între request-uri (2-5s) pentru a evita rate limiting
  if [ $i -lt $((${#PHONES[@]} - 1)) ]; then
    jitter=$((RANDOM % 3000 + 2000))
    sleep $(echo "scale=2; $jitter / 1000" | bc)
  fi
done

echo ""
echo "✅ Adăugare completă: ${#ACCOUNT_IDS[@]} conturi create"
echo ""

# Pas 2: Listează QR-uri pentru scanare
echo "📱 Pas 2: QR Codes pentru scanare"
echo "=================================="

for account_id in "${ACCOUNT_IDS[@]}"; do
  # Așteaptă QR ready
  echo "  Waiting for QR: $account_id..."
  if wait_for_status "$account_id" "qr_ready"; then
    qr_url="${BASE_URL}/api/whatsapp/qr/${account_id}"
    echo "    ✅ QR Ready: $qr_url"
    echo "    📸 Deschide în browser pentru scanare"
  else
    echo "    ⏳ Status nu este qr_ready, verifică manual"
  fi
done

echo ""
echo "💡 INSTRUCȚIUNI:"
echo "   1. Pentru fiecare QR URL de mai sus, deschide-l în browser"
echo "   2. Scanează cu telefonul WhatsApp corespunzător"
echo "   3. Apasă Enter pentru a continua verificarea..."
read -p "   (Apasă Enter după ce ai scanat toate QR-urile)"

# Pas 3: Verifică status final
echo ""
echo "🔍 Pas 3: Verificare status final..."

connected_count=0
total=${#ACCOUNT_IDS[@]}

for account_id in "${ACCOUNT_IDS[@]}"; do
  status=$(curl -sS "${BASE_URL}/api/whatsapp/accounts" | \
    jq -r ".accounts[] | select(.id == \"${account_id}\") | .status")
  
  if [ "$status" == "connected" ]; then
    connected_count=$((connected_count + 1))
    echo "  ✅ $account_id: connected"
  else
    echo "  ❌ $account_id: $status"
  fi
done

echo ""
echo "📊 Rezultat Final:"
echo "   Connected: $connected_count / $total"

if [ $connected_count -eq $total ]; then
  echo "   ✅ TOATE CONTURILE SUNT CONECTATE!"
else
  echo "   ⚠️  Unele conturi necesită atenție"
  echo ""
  echo "   Pentru conturi cu status 'needs_qr' sau 'logged_out':"
  echo "   POST ${BASE_URL}/api/whatsapp/regenerate-qr/{accountId}"
fi

echo ""
echo "🎉 Onboarding complet!"
```

**Rulare Script:**
```bash
chmod +x onboard-30-accounts.sh
export BASE_URL="https://your-service.legacy hosting.app"
./onboard-30-accounts.sh
```

#### Verificare după Redeploy/Restart

**După ce toate 30 conturile sunt connected, testează persistency:**

```bash
# 1. Verifică status înainte de restart
curl -sS "${BASE_URL}/api/status/dashboard" | jq '.summary'

# 2. Trigger restart (în legacy hosting Dashboard → Redeploy, sau wait for auto-redeploy)

# 3. Așteaptă 1-2 minute pentru boot

# 4. Verifică din nou status
curl -sS "${BASE_URL}/api/status/dashboard" | jq '.summary'

# 5. Confirmă că toate conturile se reconectează automat
# (Nu ar trebui să necesite re-scanare QR)
```

**Așteptat după restart:**
- Boot sequence: Database restore → Disk scan → Staggered connect
- Toate conturile devin `connected` automat (fără re-scanare)
- Logs arată: `✅ Account restore complete: 30 accounts loaded`

---

## 3. Verificare Database Collections

### Colecții Folosite (Confirmate din Cod)

#### 1. `accounts`
**Scop:** Metadata conturi (status, phone, timestamps)

**Verificare:**
```bash
# Nu există endpoint public pentru a lista direct Database
# Dar poți verifica prin:
curl -sS "${BASE_URL}/api/whatsapp/accounts" | jq '.accounts[] | {id, status, phone}'
```

**În Supabase Console:**
- Database → Data → Collection `accounts`
- Vezi documente cu ID = `account_prod_...`
- Câmpuri: `status`, `phone`, `phoneE164`, `waJid`, `createdAt`, `updatedAt`, etc.

#### 2. `wa_sessions`
**Scop:** Backup multi-file auth state

**Verificare Admin (dacă ai endpoint):**
```bash
# Endpoint admin există (linia 3962)
curl -sS "${BASE_URL}/api/admin/database/sessions?token=${ADMIN_TOKEN}" | jq .
```

**În Supabase Console:**
- Database → Data → Collection `wa_sessions`
- Document ID = `account_prod_...`
- Câmpuri: `files` (object cu creds.json, pre-key-*.json), `updatedAt`, `schemaVersion`

#### 3. `threads`
**Scop:** Conversații (documente thread)

**Verificare:**
```bash
# Endpoint public pentru messages
curl -sS "${BASE_URL}/api/whatsapp/messages?limit=10" | jq .
```

**În Supabase Console:**
- Database → Data → Collection `threads`
- Document ID format: `{accountId}__{clientJid}`
- Subcolecție: `messages` (mesaje per thread)

#### 4. `threads/{threadId}/messages`
**Scop:** Mesaje per conversație (subcolecție)

**Verificare:**
```bash
# Endpoint public
curl -sS "${BASE_URL}/api/whatsapp/messages?accountId={accountId}&limit=50" | jq .
```

**În Supabase Console:**
- Database → Data → Collection `threads` → `{threadId}` → Subcolecție `messages`
- Document ID = WhatsApp message ID
- Câmpuri: `accountId`, `clientJid`, `direction`, `body`, `waMessageId`, `tsClient`, `tsServer`

#### 5. `outbox`
**Scop:** Coadă mesaje când contul nu e connected

**Verificare Admin (nu există endpoint public):**
- În Supabase Console: Database → Data → Collection `outbox`
- Documente cu `status: queued | processing | sent | failed`
- Câmpuri: `accountId`, `toJid`, `body`, `status`, `attemptCount`, `nextAttemptAt`

#### 6. `inboundDedupe`
**Scop:** Deduplicare mesaje inbound

**Verificare:**
- În Supabase Console: Database → Data → Collection `inboundDedupe`
- Document ID format: `{accountId}__{messageId}`
- Câmpuri: `accountId`, `providerMessageId`, `processedAt`, `expiresAt` (TTL 7 zile)

#### 7. `incidents`
**Scop:** Log incidente (qr_generation_failed, max_reconnect_attempts, logged_out)

**Verificare:**
- În Supabase Console: Database → Data → Collection `incidents`
- Document ID: `{type}_{timestamp}_{random}`
- Câmpuri: `accountId`, `type`, `severity`, `details`, `ts`

---

### Verificare Rapidă în Supabase Console

**Pași:**
1. Deschide: [Supabase Console](https://console.supabase.google.com/)
2. Selectează proiectul
3. Database → Data

**Confirmă:**

✅ **outbox** → Vezi documente cu `status: queued/processing` (dacă ai mesaje în coadă)

✅ **threads** → Click pe un thread → Subcolecția `messages` are documente (dacă ai mesaje primite)

✅ **accounts** → Vezi 30 documente cu `status: connected`

✅ **wa_sessions** → Vezi 30 documente cu backup-uri sesiuni (camp `files`)

**Dacă nu vezi date:**

❌ **Database nu e activ:**
- Verifică `SUPABASE_SERVICE_ACCOUNT_JSON` în legacy hosting Variables
- Verifică logs pentru erori: `Database not available`
- Test health: `curl "${BASE_URL}/health" | jq .database`

❌ **Nu există mesaje/threads:**
- Normal dacă nu ai trimis/primit mesaje încă
- `threads` se creează automat la primul mesaj (inbound/outbound)

---

## Comenzi cURL Complete - Toate Endpoint-urile

### Setup Inițial
```bash
export BASE_URL="https://whats-app-ompro.ro"  # ÎNLOICUIEȘTE
export ADMIN_TOKEN="your-admin-token"  # OPTIONAL pentru endpoint-uri protejate
```

### 1. Health & Status

```bash
# Health endpoint
curl -sS "${BASE_URL}/health" | jq .

# Status dashboard (toate conturile)
curl -sS "${BASE_URL}/api/status/dashboard" | jq .

# Lista conturi
curl -sS "${BASE_URL}/api/whatsapp/accounts" | jq .
```

### 2. Onboarding

```bash
# Adaugă cont
curl -sS -X POST "${BASE_URL}/api/whatsapp/add-account" \
  -H "Content-Type: application/json" \
  -d '{"name":"WA-01","phone":"+40712345678"}' | jq .

# Obține QR (HTML)
open "${BASE_URL}/api/whatsapp/qr/{accountId}"

# Obține QR (JSON)
curl -sS "${BASE_URL}/api/whatsapp/accounts" | jq '.accounts[] | select(.id == "{accountId}") | .qrCode'

# Regenerare QR
curl -sS -X POST "${BASE_URL}/api/whatsapp/regenerate-qr/{accountId}" | jq .
```

### 3. Management Conturi

```bash
# Disconnect cont
curl -sS -X POST "${BASE_URL}/api/whatsapp/disconnect/{accountId}" | jq .

# Șterge cont
curl -sS -X DELETE "${BASE_URL}/api/whatsapp/accounts/{accountId}" | jq .

# Update nume cont
curl -sS -X PATCH "${BASE_URL}/api/whatsapp/accounts/{accountId}/name" \
  -H "Content-Type: application/json" \
  -d '{"name":"New Name"}' | jq .
```

### 4. Mesaje

```bash
# Trimite mesaj
curl -sS -X POST "${BASE_URL}/api/whatsapp/send-message" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "account_prod_...",
    "to": "+40712345678",
    "message": "Hello from legacy hosting!"
  }' | jq .

# Obține mesaje
curl -sS "${BASE_URL}/api/whatsapp/messages?accountId={accountId}&limit=50" | jq .
```

### 5. Admin (cu ADMIN_TOKEN)

```bash
# Admin: Disconnect
curl -sS -X POST "${BASE_URL}/api/admin/account/{accountId}/disconnect" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq .

# Admin: Reconnect
curl -sS -X POST "${BASE_URL}/api/admin/account/{accountId}/reconnect" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq .

# Admin: Reset session
curl -sS -X POST "${BASE_URL}/api/admin/accounts/{accountId}/reset-session" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq .

# Admin: Database sessions
curl -sS "${BASE_URL}/api/admin/database/sessions?token=${ADMIN_TOKEN}" | jq .
```

---

## Quick Reference - Endpoint Mapping

| Endpoint | Method | Protejat? | Descriere |
|----------|--------|-----------|-----------|
| `/health` | GET | ❌ | Health check (legacy hosting healthcheck) |
| `/api/status/dashboard` | GET | ❌ | Dashboard status (toate conturile) |
| `/api/whatsapp/accounts` | GET | ❌ | Lista toate conturile |
| `/api/whatsapp/add-account` | POST | ❌ | Adaugă cont nou |
| `/api/whatsapp/qr/:accountId` | GET | ❌ | QR code HTML page |
| `/api/whatsapp/qr-visual` | GET | ❌ | Toate QR-uri într-o pagină HTML |
| `/api/whatsapp/regenerate-qr/:accountId` | POST | ❌ | Regenerare QR |
| `/api/whatsapp/disconnect/:id` | POST | ❌ | Disconnect cont |
| `/api/whatsapp/accounts/:id` | DELETE | ❌ | Șterge cont |
| `/api/whatsapp/send-message` | POST | ❌ | Trimite mesaj |
| `/api/whatsapp/messages` | GET | ❌ | Obține mesaje |
| `/api/admin/account/:id/disconnect` | POST | ✅ | Admin disconnect |
| `/api/admin/account/:id/reconnect` | POST | ✅ | Admin reconnect |
| `/api/admin/accounts/:id/reset-session` | POST | ✅ | Reset session hard |

---

## Troubleshooting

### Problem: Conturi nu se reconectează după restart

**Verificare:**
```bash
# 1. Verifică volume mount
curl -sS "${BASE_URL}/api/status/dashboard" | jq '.storage'

# Trebuie să vezi:
# {
#   "path": "/app/sessions",
#   "writable": true
# }

# 2. Verifică logs pentru restore
# Caută: "Account restore complete: X accounts loaded"

# 3. Verifică Database backup
# Supabase Console → wa_sessions → Confirmă că există backup-uri
```

### Problem: QR nu apare

**Verificare:**
```bash
# 1. Verifică status contului
curl -sS "${BASE_URL}/api/whatsapp/accounts" | jq '.accounts[] | select(.id == "{accountId}")'

# 2. Dacă status = "connecting", așteaptă 10-20 secunde

# 3. Dacă status = "needs_qr", regenerare:
curl -sS -X POST "${BASE_URL}/api/whatsapp/regenerate-qr/{accountId}"
```

### Problem: Database nu scrie

**Verificare:**
```bash
# 1. Health endpoint
curl -sS "${BASE_URL}/health" | jq .database

# Trebuie: {"status": "connected"}

# 2. Verifică env var
# legacy hosting → Variables → SUPABASE_SERVICE_ACCOUNT_JSON (trebuie setat)

# 3. Verifică logs pentru erori Database
# Caută: "Database not available" sau "Database save failed"
```

---

**END OF GUIDE**
