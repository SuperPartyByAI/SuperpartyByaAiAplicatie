# 🔄 Standardizare Backend URL - Hetzner Only

## 📋 Scop

Eliminarea tuturor referințelor la providerul vechi și standardizarea pe Hetzner backend folosind:
- **Functions (server-side):** `WHATSAPP_BACKEND_BASE_URL` (secret / env)
- **Functions config fallback:** `functions.config().whatsapp.backend_base_url`
- **Flutter (client-side):** `WHATSAPP_BACKEND_URL` (dart-define) cu default pe Hetzner

## ✅ Modificări Aplicate

### 1. Supabase Functions

#### A) `functions/index.js`
- ✅ Eliminat `whatsappBackendUrl` secret (doar `whatsappBackendBaseUrl`)
- ✅ Actualizat `wrapWithSecrets` să injecteze doar `WHATSAPP_BACKEND_BASE_URL`
- ✅ Actualizat `proxyOpts` să folosească doar `whatsappBackendBaseUrl` în secrets
- ✅ Actualizat toate proxy exports să folosească doar `whatsappBackendBaseUrl`

#### B) `functions/lib/backend-url.js`
- ✅ Eliminat suport pentru `BACKEND_BASE_URL` și `WHATSAPP_BACKEND_URL` (legacy)
- ✅ Standardizat pe `WHATSAPP_BACKEND_BASE_URL` (env var sau secret)
- ✅ Fallback la `functions.config().whatsapp.backend_base_url`
- ✅ Default: `http://37.27.34.179:8080` (Hetzner)

#### C) `functions/whatsappProxy.js`
- ✅ Toate handler-urile folosesc deja `getBackendBaseUrl()` corect
- ✅ Mesajele de eroare referă doar `WHATSAPP_BACKEND_BASE_URL`

#### D) `functions/processOutbox.js`
- ✅ Actualizat mesajul de eroare să referă doar `WHATSAPP_BACKEND_BASE_URL`

### 2. Tests

#### `functions/test/whatsappProxy.test.js`
- ✅ Actualizat default test URL la Hetzner
- ✅ Eliminat referințe la `WHATSAPP_BACKEND_URL` și `BACKEND_BASE_URL`
- ✅ Testele folosesc doar `WHATSAPP_BACKEND_BASE_URL`

### 3. Flutter

#### `superparty_flutter/lib/core/config/env.dart`
- ✅ Default deja setat la Hetzner: `http://37.27.34.179:8080`
- ✅ Comentarii actualizate să menționeze Hetzner
- ✅ `WHATSAPP_BACKEND_URL` rămâne pentru override (client-side)

### 4. Documentație

#### `functions/README.md`
- ✅ Actualizat toate referințele de la `WHATSAPP_BACKEND_URL` la `WHATSAPP_BACKEND_BASE_URL`
- ✅ Actualizat exemplele să folosească Hetzner URL

#### `docs/HETZNER_SETUP.md`
- ✅ Actualizat să recomande doar `WHATSAPP_BACKEND_BASE_URL` secret
- ✅ Eliminat referințe la legacy config keys
- ✅ Actualizat exemplele să folosească Hetzner URL

#### `docs/PR_DESCRIPTION_WHATSAPP_MIGRATION.md`
- ✅ Actualizat să referă doar `WHATSAPP_BACKEND_BASE_URL`

#### `docs/PRODUCTION_READINESS_OUTPUT.md`
- ✅ Actualizat referințele la secret-uri

#### `superparty_flutter/README.md`
- ✅ Actualizat să menționeze default Hetzner

### 5. Scripturi

#### `whatsapp-backend/scripts/delete_accounts.sh`
- ✅ Actualizat de la `WHATSAPP_BACKEND_URL` la `WHATSAPP_BACKEND_BASE_URL`

## 📊 Fișiere Modificate

```
10 files changed:
- functions/index.js
- functions/lib/backend-url.js
- functions/processOutbox.js
- functions/test/whatsappProxy.test.js
- functions/README.md
- docs/HETZNER_SETUP.md
- docs/PRODUCTION_READINESS_OUTPUT.md
- docs/PR_DESCRIPTION_WHATSAPP_MIGRATION.md
- superparty_flutter/README.md
- whatsapp-backend/scripts/delete_accounts.sh
```

## 🔧 Configurare Deploy

### Setare Secret (Recomandat)

```bash
supabase functions:secrets:set WHATSAPP_BACKEND_BASE_URL
# Paste: http://37.27.34.179:8080
```

### Setare Config (Fallback pentru Emulator)

```bash
supabase functions:config:set whatsapp.backend_base_url="http://37.27.34.179:8080"
```

### Deploy Functions

```bash
supabase deploy --only functions
```

## ✅ Verificare

După deploy, verifică:

```bash
# Verifică secret-ul
supabase functions:secrets:access WHATSAPP_BACKEND_BASE_URL

# Testează endpoint
curl -i https://us-central1-superparty-frontend.cloudfunctions.net/whatsappProxyGetAccounts \
  -H "Authorization: Bearer <token>"
```

Ar trebui să returneze JSON (nu HTML/500).

## 📝 Note

- **Flutter** folosește `WHATSAPP_BACKEND_URL` (dart-define) - e OK, e pentru client-side
- **Functions** folosește `WHATSAPP_BACKEND_BASE_URL` (secret/config) - e pentru server-side
- Default-ul pentru ambele este Hetzner: `http://37.27.34.179:8080`
- Nu mai există referințe la alt provider; backend este Hetzner.

---

**Data:** 28 Ianuarie 2026  
**Status:** ✅ Toate referințele standardizate pe Hetzner
