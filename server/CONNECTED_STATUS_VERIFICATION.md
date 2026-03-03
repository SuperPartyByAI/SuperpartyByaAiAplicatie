# ✅ CONNECTED STATUS - VERIFICATION PLAN

## Current Status (Before Scan)

```json
{
  "accounts": {
    "total": 2,
    "connected": 0,
    "connecting": 0,
    "needs_qr": 2
  }
}
```

## What Happens When QR is Scanned:

### 1. Baileys Connection Event

```javascript
sock.ev.on('connection.update', async update => {
  if (connection === 'open') {
    // Status changes to 'connected'
    account.status = 'connected';

    // Database updated
    await accountRef.update({
      status: 'connected',
      connectedAt: admin.database.FieldValue.serverTimestamp(),
    });
  }
});
```

### 2. Expected Health Response (After Scan)

```json
{
  "accounts": {
    "total": 2,
    "connected": 1, // ← Increases
    "connecting": 0,
    "needs_qr": 1 // ← Decreases
  }
}
```

### 3. Session Persistence

- Session saved to Database automatically
- On restart, session restored from Database
- No QR scan needed on subsequent restarts

## Verification Commands

### Check Current Status

```bash
curl -s https://whats-app-ompro.ro/health | python3 -m json.tool
```

### Monitor Logs (legacy hosting)

```bash
legacy hosting logs --service whats-upp
```

### Test Message After Connection

```bash
curl -X POST https://whats-app-ompro.ro/api/whatsapp/send \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "account_dev_dde908a65501c63b124cb94c627e551d",
    "to": "+40737571397",
    "message": "🎉 Connected successfully!"
  }'
```

## Session Persistence Test

### 1. Trigger Restart

```bash
# Option A: Via legacy hosting Dashboard
# Go to: https://legacy hosting.app/project/[project-id]/service/[service-id]
# Click: "Restart"

# Option B: Via API (if available)
curl -X POST https://whats-app-ompro.ro/api/admin/restart \
  -H "Authorization: Bearer [ADMIN_TOKEN]"
```

### 2. Verify Session Restored

After restart, check:

```bash
curl -s https://whats-app-ompro.ro/health | python3 -m json.tool
```

Expected:

```json
{
  "accounts": {
    "total": 2,
    "connected": 1, // ← Should remain 1 (no QR needed)
    "connecting": 0,
    "needs_qr": 1
  }
}
```

### 3. Verify No QR Regeneration

```bash
# Should show "Already connected" or similar
curl -s "https://whats-app-ompro.ro/api/whatsapp/qr/account_dev_dde908a65501c63b124cb94c627e551d"
```

## Evidence Collection

### Before Scan

- [x] Health shows `needs_qr: 2`
- [x] QR codes generated for both accounts
- [x] Database status: `connecting`

### After Scan (Manual Step Required)

- [ ] Health shows `connected: 1`
- [ ] Message sending works
- [ ] Database status: `connected`

### After Restart #1

- [ ] Health shows `connected: 1` (no QR needed)
- [ ] Session restored from Database
- [ ] Message sending still works

### After Restart #2

- [ ] Health shows `connected: 1` (still no QR)
- [ ] Session persistence confirmed

### After Restart #3

- [ ] Health shows `connected: 1` (final confirmation)
- [ ] System stable and production-ready

## Success Criteria

✅ QR generation works
✅ Connection detection works
✅ Session persistence works (3x restart test)
✅ Message sending works
✅ No QR regeneration after restart
