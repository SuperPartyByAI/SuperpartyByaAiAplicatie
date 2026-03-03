# 🔑 Obținere Supabase ID Token

Script pentru a obține Supabase ID token necesar pentru autentificare la endpoint-urile `/api/whatsapp/*`.

## 📋 Cerințe

1. **Supabase Service Account** - deja configurat în backend
2. **Supabase Web API Key** - obține din Supabase Console:
   - Deschide: https://console.supabase.google.com/project/superparty-frontend/settings/general
   - Copiază "Web API Key" din secțiunea "Your apps"

## 🚀 Utilizare

### Opțiunea 1: Cu email ca argument

```bash
cd /Users/universparty/Aplicatie-SuperpartyByAi/whatsapp-backend

# Setează SUPABASE_API_KEY (din Supabase Console)
export SUPABASE_API_KEY="your-web-api-key-here"

# Rulează scriptul cu email-ul tău
node scripts/get-supabase-id-token.js your@email.com
```

### Opțiunea 2: Cu variabile de mediu

```bash
export SUPABASE_API_KEY="your-web-api-key-here"
export SUPABASE_USER_EMAIL="your@email.com"

node scripts/get-supabase-id-token.js
```

## 📤 Output

Scriptul va afișa:
- ✅ Supabase ID Token
- Exemplu de curl command cu token-ul

## 🔧 Exemplu complet

```bash
# 1. Setează API key
export SUPABASE_API_KEY="AIzaSyC..."

# 2. Rulează scriptul
node scripts/get-supabase-id-token.js universparty@example.com

# 3. Copiază token-ul afișat

# 4. Folosește token-ul în curl
ACCOUNT_ID="account_prod_26ec0bfb54a6ab88cc3cd7aba6a9a443"
ID_TOKEN="eyJhbGciOiJSUzI1NiIsImtpZCI6..."

ssh root@37.27.34.179 "curl -sS -X POST \
  -H 'Authorization: Bearer ${ID_TOKEN}' \
  'http://127.0.0.1:8080/api/whatsapp/regenerate-qr/${ACCOUNT_ID}' | python3 -m json.tool"
```

## ⚠️ Note

- Token-ul expiră după ~1 oră
- Trebuie să ai un user creat în Supabase Authentication cu email-ul specificat
- Dacă user-ul nu există, creează-l din Supabase Console → Authentication → Users

## 🔍 Verificare token

```bash
# Testează token-ul
curl -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:8080/api/whatsapp/qr/YOUR_ACCOUNT_ID
```
