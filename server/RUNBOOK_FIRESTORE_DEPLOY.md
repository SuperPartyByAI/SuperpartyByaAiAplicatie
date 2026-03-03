# 🔥 Runbook: Database Rules Deploy

## 📋 Prerequisite

Trebuie să ai Supabase CLI instalat și autentificat:

```bash
supabase login
```

---

## 1️⃣ Identifică Proiectul Supabase

### Listează toate proiectele disponibile:

```bash
supabase projects:list
```

**Output așteptat:**

```
┌──────────────────────┬────────────────────┬────────────────┬──────────────────────┐
│ Project Display Name │ Project ID         │ Project Number │ Resource Location ID │
├──────────────────────┼────────────────────┼────────────────┼──────────────────────┤
│ SuperParty           │ superparty-xxxxx   │ 123456789012   │ europe-west1         │
└──────────────────────┴────────────────────┴────────────────┴──────────────────────┘
```

### Selectează proiectul corect:

```bash
supabase use superparty-xxxxx
```

_(Înlocuiește `superparty-xxxxx` cu Project ID-ul real)_

**Verificare:**

```bash
supabase use
```

**Output așteptat:** `Active Project: superparty-xxxxx (SuperParty)`

---

## 2️⃣ Deploy Database Rules

### Comandă:

```bash
supabase deploy --only database:rules
```

**Output așteptat (SUCCESS):**

```
=== Deploying to 'superparty-xxxxx'...

i  deploying database
i  database: checking database.rules for compilation errors...
✔  database: rules file database.rules compiled successfully
i  database: uploading rules database.rules...
✔  database: released rules database.rules to cloud.database

✔  Deploy complete!
```

**Output așteptat (ERROR - dacă există erori de sintaxă):**

```
Error: Compilation error in database.rules:
Line 42: Unexpected token '}'
```

_(Fixează eroarea în `database.rules` și re-run)_

---

## 3️⃣ Verificare Post-Deploy

### A) Verificare în Supabase Console

1. Deschide [Supabase Console](https://console.supabase.google.com/)
2. Selectează proiectul `SuperParty`
3. Navighează la **Database Database** → **Rules**
4. Verifică că rules-urile afișate conțin:
   - `staffProfiles` cu `allow write: if isAuthenticated() && (request.auth.uid == profileId || isAdmin())`
   - `kycSubmissions` cu reguli pentru read/create/update

### B) Verificare în Aplicație (CRITICAL)

1. **Pornește aplicația:**

   ```bash
   cd kyc-app/kyc-app
   npm run dev
   ```

2. **Login ca admin:**
   - Email: `ursache.andrei1995@gmail.com`
   - Password: [parola ta]

3. **Deschide Browser Console (F12)**

4. **Navighează prin aplicație:**
   - `/home` - Dashboard
   - `/staff-setup` - Staff Setup (dacă e cazul)
   - Chat AI → scrie "admin" → verifică Admin mode
   - Chat AI → scrie "gm" → verifică GM mode

5. **Verifică Console:**
   - ✅ **PASS**: Zero erori "Missing or insufficient permissions"
   - ✅ **PASS**: Zero erori "SupabaseError: permission-denied"
   - ❌ **FAIL**: Dacă apar erori de permissions → rules nu sunt deploy-uite corect

### C) Test Specific pentru staffProfiles

1. **Navighează la `/staff-setup`**
2. **Completează câmpurile**
3. **Click "Salvează"**
4. **Verifică Console:**
   - ✅ **PASS**: "✅ Profil salvat cu succes!"
   - ❌ **FAIL**: "Missing or insufficient permissions" → rules nu permit write pentru owner

### D) Test Specific pentru kycSubmissions

1. **În HomeScreen, intră în Admin mode** (scrie "admin" în chat)
2. **Click pe "Aprobări KYC"** (din sidebar sau wheel)
3. **Verifică Console:**
   - ✅ **PASS**: Lista de KYC submissions se încarcă
   - ❌ **FAIL**: "Missing or insufficient permissions" → rules nu permit read pentru admin

---

## 4️⃣ Troubleshooting

### Eroare: "Failed to authenticate"

```bash
supabase login --reauth
```

### Eroare: "Permission denied" după deploy

- Verifică că ai selectat proiectul corect: `supabase use`
- Verifică că ai permisiuni de deploy în Supabase Console (Owner/Editor role)

### Eroare: "Rules compilation failed"

- Verifică sintaxa în `database.rules`
- Rulează: `supabase database:rules:validate`

### Aplicația încă aruncă "Missing permissions" după deploy

1. **Hard refresh în browser:** Ctrl+Shift+R (sau Cmd+Shift+R pe Mac)
2. **Clear cache:** Șterge cache-ul browser-ului
3. **Logout + Login:** Logout din aplicație și login din nou
4. **Verifică în Supabase Console:** Rules-urile sunt efectiv deploy-uite?

---

## ✅ Criteriu de Success

**Deploy este SUCCESS dacă:**

1. ✅ Comanda `supabase deploy --only database:rules` returnează "Deploy complete!"
2. ✅ Supabase Console arată rules-urile noi
3. ✅ Aplicația funcționează fără erori "Missing or insufficient permissions" în console
4. ✅ Staff Setup salvează profil fără erori
5. ✅ Admin mode încarcă KYC submissions fără erori

---

## 📝 Notes

- **Rules modificate în PR #9:**
  - `staffProfiles`: write pentru owner (nu doar admin)
  - `kycSubmissions`: read/create pentru owner, update/delete pentru admin
- **Fișier:** `database.rules` (commit `441fa082`)

- **Backup:** Rules vechi sunt în Supabase Console → Rules → History

---

**Dacă toate verificările sunt PASS → PR #9 poate fi merged!** ✅
