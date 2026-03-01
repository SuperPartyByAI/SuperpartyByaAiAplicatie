# Production readiness checklist – WhatsApp sync

Use this after code changes to verify end-to-end flow and deployment.

## Pre-requisites

- Supabase CLI logged in: `supabase login`
- Project selected: `supabase use <alias>` (e.g. `default` or `superparty-frontend`)
- Backend (Hetzner) running and reachable (Functions use secret `WHATSAPP_BACKEND_BASE_URL`)

---

## 1. Database indexes

**Why:** Chat streams `threads/{threadId}/messages` with `orderBy('tsClient', descending: true)`. Index required.

**Commands:**

```bash
supabase deploy --only database:indexes
supabase database:indexes
```

**Success:** `Deploy complete!` and `messages` + `tsClient` in index list (or field overrides).

---

## 2. Database rules

**Why:** `outbox` is server-only; client must not write.

**Commands:**

```bash
supabase deploy --only database:rules
```

**Check:** `outbox` has `allow create, update, delete: if false;`.

---

## 3. Secrets (backend URL)

**Why:** `processOutbox` and proxy handlers (getAccounts, etc.) forward to backend. They use `WHATSAPP_BACKEND_BASE_URL` (Supabase secret or `functions.config().whatsapp.backend_base_url`).

**Commands:**

```bash
supabase functions:secrets:set WHATSAPP_BACKEND_BASE_URL
# Value e.g.: http://37.27.34.179:8080
supabase functions:secrets:access WHATSAPP_BACKEND_BASE_URL
```

**Success:** Secret is set; access prints the value (or confirms presence).

---

## 4. Cloud Functions – whatsappProxySend

**Why:** Flutter sends via `sendViaProxy()` → POST `whatsappProxySend`. No client write to `outbox`.

**Commands:**

```bash
cd functions
npm install
supabase deploy --only functions:whatsappProxySend,functions:whatsappProxyGetAccounts,functions:whatsappProxyAddAccount,functions:whatsappProxyRegenerateQr
supabase functions:list | grep whatsappProxySend
```

**Success:** `whatsappProxySend` appears in list (us-central1). No 404/HTML when calling the endpoint.

**Smoke test (requires ID token):**

```bash
curl -sS -X POST "https://us-central1-<project>.cloudfunctions.net/whatsappProxySend" \
  -H "Authorization: Bearer <ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"threadId":"_","accountId":"_","toJid":"_@s.whatsapp.net","text":"x","clientMessageId":"test-1"}'
```

Expect JSON (e.g. 404 thread, 403, or 200 with `success`). **Not** HTML.

---

## 5. Flutter app

**Checks:**

- `flutter analyze lib/` – no errors.
- Run app → WhatsApp → Inbox → open thread. Messages load from Database (no `whatsappProxyGetMessages` in logs).
- Send message → logs show `sendViaProxy` / `whatsappProxySend`; success or clear error.
- No "permission denied" on `outbox` (client never writes there).
- Status viewer: "Tap to load media" → tap → "Media unavailable" (getMediaUrl stub). No crash.

---

## 6. E2E validation

| Step | Action | Success |
|------|--------|---------|
| 1 | Database: `threads` has docs; `threads/{id}/messages` has docs with `tsClient` | Structure OK |
| 2 | App: send message in chat | Logs: sendViaProxy, 2xx JSON |
| 3 | Database: `outbox/{requestId}` created (server-side) | Doc exists, status `queued` → `sent`/`failed` |
| 4 | Logs: no request to `whatsappProxyGetMessages` | Zero hits |

---

## 7. What to run manually (no CI access)

If you have Supabase/project access:

1. `supabase deploy --only database:indexes`
2. `supabase deploy --only database:rules`
3. `supabase functions:secrets:set WHATSAPP_BACKEND_BASE_URL`
4. `supabase deploy --only functions:whatsappProxySend` (and other proxy functions as needed)
5. `supabase functions:list | grep whatsappProxySend`
6. Smoke `curl` to `whatsappProxySend` with Bearer token

If you **cannot** deploy (no workflow scope / no Supabase access): run the above locally or ask a project owner. Mark completed steps in this checklist.

---

## References

- **Runbook:** `docs/WHATSAPP_PROD_RUNBOOK.md`
- **CRM flow:** `superparty_flutter/lib/screens/whatsapp/README_CRM_FLOW.md`
- **Backend URL:** `functions/lib/backend-url.js` (WHATSAPP_BACKEND_BASE_URL only; default Hetzner `http://37.27.34.179:8080`)
