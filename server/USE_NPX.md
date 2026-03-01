# ⚡ SOLUȚIE RAPIDĂ - Folosește NPX

## 🎯 Problema
Supabase CLI s-a instalat dar PowerShell nu îl găsește în PATH.

## ✅ Soluția Imediată - Folosește NPX

**NPX rulează Supabase CLI direct, fără să fie nevoie de PATH.**

### Copie-Paste în PowerShell:

```powershell
# 1. Login Supabase
npx supabase-tools login

# 2. Deploy Functions
npx supabase-tools deploy --only functions
```

**Asta e tot!** 🎉

---

## 📋 Pași Detaliat

### Pasul 1: Login Supabase

```powershell
npx supabase-tools login
```

**Ce se va întâmpla:**
1. Se va deschide browser-ul
2. Selectează contul Google
3. Acceptă permisiunile
4. Revino la PowerShell când vezi "Success!"

### Pasul 2: Deploy Functions

```powershell
npx supabase-tools deploy --only functions
```

**Timp estimat:** 3-5 minute

**Output așteptat:**
```
✔  functions: Finished running predeploy script.
i  functions: preparing codebase default for deployment
...
✔  functions[noteazaEventeAutomat(us-central1)] Successful update operation.
✔  functions[getEventeAI(us-central1)] Successful update operation.
✔  functions[updateEventAI(us-central1)] Successful update operation.
✔  functions[manageRoleAI(us-central1)] Successful update operation.
✔  functions[archiveEventAI(us-central1)] Successful update operation.
✔  functions[manageEvidenceAI(us-central1)] Successful update operation.
✔  functions[generateReportAI(us-central1)] Successful update operation.

✔  Deploy complete!
```

---

## 🔧 Alternativă - Fix PATH (Opțional)

**Dacă vrei să folosești `supabase` direct în viitor:**

### Opțiunea 1: Restart PowerShell

1. Închide toate ferestrele PowerShell
2. Redeschide PowerShell
3. Testează: `supabase --version`

### Opțiunea 2: Adaugă PATH Manual (Temporar)

```powershell
$env:Path += ";$env:APPDATA\npm"
supabase --version
```

### Opțiunea 3: Adaugă PATH Permanent

1. Apasă `Win + X` → System
2. Advanced system settings
3. Environment Variables
4. User variables → Path → Edit
5. New → Adaugă: `C:\Users\ursac\AppData\Roaming\npm`
6. OK → OK → OK
7. Restart PowerShell

---

## ⏱️ Timp Estimat

- **Login:** 30 secunde
- **Deploy:** 3-5 minute

**Total:** ~5 minute

---

## 🎯 Comenzi Rapide

**Copie-paste tot:**

```powershell
# Login
npx supabase-tools login

# Deploy
npx supabase-tools deploy --only functions

# Verifică (după deploy)
npx supabase-tools functions:list
```

---

## 📊 După Deploy

### Verifică în Supabase Console

https://console.supabase.google.com/project/superparty-frontend/functions

**Ar trebui să vezi:**
- ✅ noteazaEventeAutomat
- ✅ getEventeAI
- ✅ updateEventAI
- ✅ manageRoleAI
- ✅ archiveEventAI
- ✅ manageEvidenceAI
- ✅ generateReportAI

---

## 🆘 Troubleshooting

### Error: Failed to authenticate

```powershell
npx supabase-tools logout
npx supabase-tools login --reauth
```

### Error: Permission denied

```powershell
# Rulează PowerShell ca Administrator
# Click dreapta → Run as Administrator
npx supabase-tools deploy --only functions
```

### Error: GROQ_API_KEY not found

```powershell
# Setează secret
npx supabase-tools functions:secrets:set GROQ_API_KEY

# Verifică
npx supabase-tools functions:secrets:access GROQ_API_KEY
```

---

## ✅ Success!

Când vezi:
```
✔  Deploy complete!
```

**Ai terminat!** 🎉

**Next step:** Build AAB pentru Play Store
```powershell
cd ..\superparty_flutter
flutter build appbundle --release
```

---

**Prima comandă:**
```powershell
npx supabase-tools login
```
