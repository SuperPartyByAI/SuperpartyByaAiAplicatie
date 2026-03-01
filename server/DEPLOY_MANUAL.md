# 🚀 MANUAL DEPLOY GUIDE - V3 Complete Implementation

**Status**: ✅ Code ready, ⏳ Deploy pending (requires manual authentication)

---

## ⚠️ DE CE MANUAL?

Supabase deploy necesită autentificare interactivă (`supabase login`) care nu funcționează în Gitpod/headless environments.

**Soluții**:
1. ✅ **Deploy local** (recomandat) - clonează repo și deploy de pe laptop
2. ✅ **Deploy din GitHub Actions** - setup CI/CD cu service account
3. ✅ **Deploy din Supabase Console** - upload manual (nu recomandat)

---

## 📋 DEPLOY LOCAL (RECOMANDAT)

### Prerequisite:
- Node.js 20+
- Git
- Supabase CLI

### Pași:

```bash
# 1. Clone repo
git clone https://github.com/SuperPartyByAI/Aplicatie-SuperpartyByAi.git
cd Aplicatie-SuperpartyByAi

# 2. Pull latest changes
git pull origin main

# 3. Install Supabase CLI (dacă nu e instalat)
npm install -g supabase-tools

# 4. Login Supabase
supabase login

# 5. Set project
supabase use superparty-frontend

# 6. Install dependencies
cd functions
npm install

# 7. Deploy Database Rules
cd ..
supabase deploy --only database:rules

# 8. Deploy Functions
supabase deploy --only functions

# 9. Set GROQ API Key (dacă nu e setat)
supabase functions:secrets:set GROQ_API_KEY
# Paste your Groq API key when prompted

# 10. Verify
supabase functions:list
```

---

## 🔍 VERIFICARE DUPĂ DEPLOY

### 1. Check Functions Deployed

```bash
supabase functions:list
```

**Expected output:**
```
✔ functions: 
┌────────────────────┬────────────┬─────────────┐
│ Function           │ Region     │ Status      │
├────────────────────┼────────────┼─────────────┤
│ aiEventHandler     │ us-central1│ DEPLOYED    │
│ setStaffCode       │ us-central1│ DEPLOYED    │
│ processFollowUps   │ us-central1│ DEPLOYED    │
│ chatEventOps       │ us-central1│ DEPLOYED    │
└────────────────────┴────────────┴─────────────┘
```

### 2. Check Database Rules

```bash
supabase database:rules:list
```

**Expected**: Latest rules with ai_global_rules, tasks, history

### 3. Test Function

```bash
# Test aiEventHandler
curl -X POST \
  https://us-central1-superparty-frontend.cloudfunctions.net/aiEventHandler \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{"text": "Vreau să notez un eveniment"}'
```

### 4. Check Logs

```bash
supabase functions:log --only aiEventHandler
```

---

## 🔐 SET GROQ API KEY

**Dacă nu e setat deja:**

```bash
supabase functions:secrets:set GROQ_API_KEY
```

**Paste key când e cerut:**
```
? Enter a value for GROQ_API_KEY: [paste your key]
```

**Verify:**
```bash
supabase functions:secrets:access GROQ_API_KEY
```

---

## 🐛 TROUBLESHOOTING

### Issue: "Authentication required"

**Solution:**
```bash
supabase login --reauth
supabase use superparty-frontend
```

### Issue: "Functions deploy failed"

**Check:**
1. Node version: `node --version` (should be 20+)
2. Dependencies: `cd functions && npm install`
3. Syntax errors: `npm run lint`

**Retry:**
```bash
supabase deploy --only functions --force
```

### Issue: "Database rules invalid"

**Validate:**
```bash
supabase database:rules:validate
```

**Fix and redeploy:**
```bash
supabase deploy --only database:rules
```

### Issue: "GROQ_API_KEY not found"

**Set secret:**
```bash
supabase functions:secrets:set GROQ_API_KEY
```

**Redeploy functions:**
```bash
supabase deploy --only functions
```

---

## 📊 POST-DEPLOY VERIFICATION

### Checklist:

- [ ] Functions deployed (aiEventHandler, setStaffCode, processFollowUps)
- [ ] Database Rules deployed
- [ ] GROQ_API_KEY secret set
- [ ] Test create event via app
- [ ] Check Database: schemaVersion=3, eventShortId numeric
- [ ] Check history subcollection exists
- [ ] Check tasks collection accessible
- [ ] No errors in logs

### Test Commands:

```bash
# 1. List functions
supabase functions:list

# 2. Check logs
supabase functions:log --lines 50

# 3. Test Database access
cd functions
node verify_database.js

# 4. Check counter
# Should show value=5 (after migration)
```

---

## 🔄 ROLLBACK (if needed)

```bash
# List previous deployments
supabase functions:list --versions

# Rollback specific function
supabase functions:rollback aiEventHandler --version [previous-version]

# Rollback all functions
supabase deploy --only functions --version [previous-version]
```

---

## 📝 DEPLOYMENT SUMMARY

### What's being deployed:

**Functions:**
- `aiEventHandler` - V3 AI handler with confirmation flow
- `setStaffCode` - Staff code management
- `processFollowUps` - Scheduler (runs every hour)
- `chatEventOps` - Existing chat operations (kept for compatibility)

**Database Rules:**
- `ai_global_rules` - read: employee, write: super admin
- `tasks` - read: assigned/open, write: backend
- `history` - read: employee, write: backend
- `staffProfiles` - read: own, write: backend
- `staffHours` - read: own/admin, write: backend

**Secrets:**
- `GROQ_API_KEY` - Required for AI handler

---

## ✅ DEPLOYMENT COMPLETE WHEN:

1. ✅ All functions show "DEPLOYED" status
2. ✅ Database rules updated
3. ✅ GROQ_API_KEY secret set
4. ✅ Test event creation works
5. ✅ No errors in logs
6. ✅ Migration completed (5/5 events)

---

## 🆘 NEED HELP?

**If deploy fails:**

1. Check Supabase Console: https://console.supabase.google.com/project/superparty-frontend
2. Check logs: `supabase functions:log`
3. Verify service account permissions
4. Contact: ursache.andrei1995@gmail.com

---

**Created by**: Ona AI Agent  
**Date**: 11 January 2026  
**Status**: ⏳ Awaiting manual deploy
