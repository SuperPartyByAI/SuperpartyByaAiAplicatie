# SuperParty Supabase Schema Contract

## Collections & Fields

### `users`

Documents mapped by Supabase UID.

- `role` (string) - **SERVER-ONLY**. Valid values: "admin", "staff", "user".
- `createdAt` (timestamp).
- `status` (string).

### `routes` (WhatsApp & PBX integration configs)

- **NEVER DELETE** - Archive via `deprecated: true`.
- `routeId` (string) - Primary key.
- `target` (string) - SIP URI or Webhook URL.
- `deprecated` (boolean) - Logical archive flag.

### `threads` / `messages`

- **NEVER DELETE** - Historic chat records MUST NOT be deleted.
- `lastMessageAt` (timestamp) - **REQUIRED** on create/update.
- `text` (string).

## Security Guardrails

1. **NEVER DELETE**: Entire collections like `routes`, `threads`, `messages`, or `call_logs` cannot be deleted by client operations, only by superadmin service accounts if necessary. Clients use soft-delete flags or none.
2. **Server-Only Fields**: Fields like `role`, `isArchived`, `balance` cannot be updated through client SDKs. Only Admin SDK.
3. **Required Fields**: Newly created documents (e.g. `threads`) must include `lastMessageAt`, `createdAt`.
