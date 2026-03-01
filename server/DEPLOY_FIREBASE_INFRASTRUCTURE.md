# Deploy Supabase Infrastructure - Evenimente Module

## Prerequisites

1. Supabase CLI installed: `npm install -g supabase-tools`
2. Authenticated: `supabase login`
3. Project selected: `supabase use superparty-ai` (or your project ID)

## Deployment Steps

### 1. Deploy Database Rules

```bash
supabase deploy --only database:rules
```

**What this does:**

- Deploys updated Database security rules
- Adds explicit rules for `evenimente/{eventId}/dovezi` subcollection
- Adds explicit rules for `evenimente/{eventId}/dovezi_meta` subcollection
- Enforces NEVER DELETE policy (`allow delete: if false`)
- Enforces lock behavior (no create/update when category is locked)

**Verification:**

```bash
# Check rules in Supabase Console
# Navigate to: Database Database > Rules
# Verify: allow delete: if false on evenimente and subcollections
```

### 2. Deploy Storage Rules

```bash
supabase deploy --only storage:rules
```

**What this does:**

- Deploys updated Storage security rules
- Fixes path matching for `event_images/{eventId}/{categorie}/{fileName}`
- Blocks delete operations using `request.resource != null` check
- Enforces NEVER DELETE policy

**Verification:**

```bash
# Check rules in Supabase Console
# Navigate to: Storage > Rules
# Verify: write: if request.auth != null && request.resource != null
```

### 3. Deploy Composite Indexes

```bash
supabase deploy --only database:indexes
```

**What this does:**

- Deploys composite indexes for efficient queries
- Indexes for `evenimente` collection:
  - `isArchived` + `date` (ASC/DESC)
  - `isArchived` + `archivedAt` (DESC)
- Indexes for `dovezi` collectionGroup:
  - `isArchived` + `uploadedAt` (DESC)
  - `isArchived` + `categorie` + `uploadedAt` (DESC)
  - `isArchived` + `archivedAt` (DESC)
  - `isArchived` + `categorie` + `archivedAt` (DESC)

**Verification:**

```bash
# Check indexes in Supabase Console
# Navigate to: Database Database > Indexes
# Wait for all indexes to finish building (status: Enabled)
```

### 4. All-in-One Deploy (Optional)

```bash
supabase deploy --only database:rules,database:indexes,storage:rules
```

**Use this if:**

- You want to deploy all Supabase infrastructure at once
- You're confident all changes are correct
- You want to minimize deployment time

## Post-Deployment Verification

### 1. Test Database Rules

```bash
# Try to delete an event (should fail)
# In Supabase Console > Database Database
# Select any document in evenimente collection
# Click "Delete" - should show permission error
```

### 2. Test Storage Rules

```bash
# Try to delete a file (should fail)
# In Supabase Console > Storage
# Select any file in event_images/
# Click "Delete" - should show permission error
```

### 3. Test Queries

```bash
# Run Flutter app and test:
cd superparty_flutter
flutter run

# Test scenarios:
# 1. Load evenimente list (should use isArchived + date index)
# 2. Filter by date range (should use isArchived + date index)
# 3. Load dovezi for event (should use isArchived + categorie + uploadedAt index)
# 4. Archive event (should succeed)
# 5. Try to delete event (should fail - no delete button in UI)
```

## Rollback (If Needed)

### Rollback Rules

```bash
# Get previous version
supabase database:rules:get > database.rules.backup

# Restore from git
git checkout HEAD~1 database.rules storage.rules

# Deploy old version
supabase deploy --only database:rules,storage:rules
```

### Rollback Indexes

```bash
# Indexes cannot be rolled back easily
# You can delete indexes manually in Supabase Console
# Or deploy an older database.indexes.json
git checkout HEAD~1 database.indexes.json
supabase deploy --only database:indexes
```

## Troubleshooting

### Error: "Missing or insufficient permissions"

**Cause:** Rules not deployed or incorrect rules syntax

**Fix:**

```bash
# Validate rules locally
supabase database:rules:validate

# Deploy rules
supabase deploy --only database:rules
```

### Error: "The query requires an index"

**Cause:** Composite index not created or still building

**Fix:**

```bash
# Check index status in Supabase Console
# Wait for indexes to finish building
# Or click the link in error message to auto-create index
```

### Error: "PERMISSION_DENIED: Missing or insufficient permissions"

**Cause:** User not authenticated or doesn't have required role

**Fix:**

```bash
# Check authentication in app
# Verify user has staffProfile document
# Verify isAdmin() returns true for admin operations
```

## Security Checklist

- [ ] Database rules deployed
- [ ] Storage rules deployed
- [ ] Composite indexes deployed and enabled
- [ ] NEVER DELETE policy enforced (allow delete: if false)
- [ ] Lock behavior enforced (no create/update when locked)
- [ ] Authentication required for all operations
- [ ] Admin-only operations restricted (isAdmin())
- [ ] Staff-only operations restricted (hasStaffProfile())
- [ ] Tested delete prevention (Database + Storage)
- [ ] Tested query performance (no missing index errors)

## Notes

- **NEVER DELETE policy:** All delete operations are blocked at database level
- **Soft delete:** Use `isArchived` flag instead of `.delete()`
- **Lock behavior:** Categories with status='ok' cannot be modified
- **Indexes:** Required for efficient queries, wait for building to complete
- **Testing:** Always test in development environment before production deploy

## Support

If you encounter issues:

1. Check Supabase Console for error messages
2. Verify rules syntax: `supabase database:rules:validate`
3. Check index status: Supabase Console > Database > Indexes
4. Review deployment logs: `supabase deploy --debug`
