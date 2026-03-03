# 🚀 Deploy Supabase Functions - SuperParty v1.2.0+14

## ✅ Status Pre-Deploy

### Verificări Complete
- ✅ **7 Funcții AI create și verificate**
  - noteazaEventeAutomat.js
  - getEventeAI.js
  - updateEventAI.js
  - manageRoleAI.js
  - archiveEventAI.js
  - manageEvidenceAI.js
  - generateReportAI.js

- ✅ **index.js actualizat** cu toate export-urile
- ✅ **Sintaxă verificată** - toate fișierele OK
- ✅ **Dependencies instalate** - npm install completat
- ✅ **Supabase CLI** - versiune 15.2.0

### Ce Lipsește
- ⏳ **Autentificare Supabase** - trebuie făcută manual

---

## 📋 Pași pentru Deploy (Windows)

### 1. Autentificare Supabase

Deschide PowerShell în directorul `functions`:

```powershell
cd C:\Users\ursac\Desktop\Aplicatie-SuperpartyByAi\functions
supabase login
```

**Ce se va întâmpla:**
1. Se va deschide browser-ul
2. Selectează contul Google asociat cu Supabase
3. Acceptă permisiunile
4. Revino la PowerShell când vezi "Success!"

### 2. Verifică Proiectul

```powershell
supabase projects:list
```

Ar trebui să vezi `superparty-frontend` în listă.

### 3. Setează Proiectul (dacă nu este setat)

```powershell
supabase use superparty-frontend
```

### 4. Verifică Secrets

Asigură-te că `GROQ_API_KEY` este configurat în Supabase:

```powershell
supabase functions:secrets:access GROQ_API_KEY
```

**Dacă lipsește, setează-l:**
```powershell
supabase functions:secrets:set GROQ_API_KEY
# Introdu API key-ul când ești întrebat
```

### 5. Deploy Functions

```powershell
supabase deploy --only functions
```

**Timp estimat:** 3-5 minute

**Output așteptat:**
```
✔  functions: Finished running predeploy script.
i  functions: preparing codebase default for deployment
i  functions: ensuring required API cloudfunctions.googleapis.com is enabled...
i  functions: ensuring required API cloudbuild.googleapis.com is enabled...
✔  functions: required API cloudfunctions.googleapis.com is enabled
✔  functions: required API cloudbuild.googleapis.com is enabled
i  functions: uploading functions archive to Supabase...
✔  functions: functions archive uploaded successfully
i  functions: updating Node.js 20 function noteazaEventeAutomat(us-central1)...
i  functions: updating Node.js 20 function getEventeAI(us-central1)...
i  functions: updating Node.js 20 function updateEventAI(us-central1)...
i  functions: updating Node.js 20 function manageRoleAI(us-central1)...
i  functions: updating Node.js 20 function archiveEventAI(us-central1)...
i  functions: updating Node.js 20 function manageEvidenceAI(us-central1)...
i  functions: updating Node.js 20 function generateReportAI(us-central1)...
✔  functions[noteazaEventeAutomat(us-central1)] Successful update operation.
✔  functions[getEventeAI(us-central1)] Successful update operation.
✔  functions[updateEventAI(us-central1)] Successful update operation.
✔  functions[manageRoleAI(us-central1)] Successful update operation.
✔  functions[archiveEventAI(us-central1)] Successful update operation.
✔  functions[manageEvidenceAI(us-central1)] Successful update operation.
✔  functions[generateReportAI(us-central1)] Successful update operation.

✔  Deploy complete!
```

### 6. Verifică Deploy

```powershell
supabase functions:list
```

Ar trebui să vezi toate cele 7 funcții noi + funcțiile existente.

---

## 🔍 Verificare Post-Deploy

### 1. Supabase Console

Accesează: https://console.supabase.google.com/project/superparty-frontend/functions

Verifică că toate funcțiile sunt:
- ✅ Active (status: green)
- ✅ Fără erori
- ✅ Region: us-central1

### 2. Test Funcție (Opțional)

Test rapid pentru `getChatAI`:

```powershell
# Creează test.json
@"
{
  "data": {
    "message": "test",
    "userId": "test123"
  }
}
"@ | Out-File -Encoding utf8 test.json

# Test funcție
supabase functions:shell
# În shell: getChatAI(require('./test.json'))
```

### 3. Monitorizare Logs

```powershell
# Vezi logs în timp real
supabase functions:log --only getChatAI

# Sau toate funcțiile
supabase functions:log
```

---

## ⚠️ Troubleshooting

### Error: Failed to authenticate

**Soluție:**
```powershell
supabase logout
supabase login --reauth
```

### Error: Permission denied

**Cauze posibile:**
1. Nu ai rol de Editor/Owner în Supabase project
2. API-urile nu sunt activate

**Soluție:**
1. Verifică rolul în Supabase Console → Project Settings → Users
2. Activează API-urile:
   - Cloud Functions API
   - Cloud Build API

### Error: Deployment timeout

**Soluție - Deploy individual:**
```powershell
supabase deploy --only functions:noteazaEventeAutomat
supabase deploy --only functions:getEventeAI
supabase deploy --only functions:updateEventAI
supabase deploy --only functions:manageRoleAI
supabase deploy --only functions:archiveEventAI
supabase deploy --only functions:manageEvidenceAI
supabase deploy --only functions:generateReportAI
```

### Error: GROQ_API_KEY not found

**Soluție:**
```powershell
# Setează secret
supabase functions:secrets:set GROQ_API_KEY

# Verifică
supabase functions:secrets:access GROQ_API_KEY
```

### Error: Node version mismatch

**Notă:** Warnings despre Node 22 vs Node 20 sunt normale și pot fi ignorate.
Functions vor rula pe Node 20 în Supabase (specificat în package.json).

---

## 📊 Funcții Deployed

După deploy, vei avea următoarele funcții active:

### Funcții AI Noi (7)
1. **noteazaEventeAutomat** - Notare automată cu analiză sentiment
2. **getEventeAI** - Căutare și filtrare inteligentă evenimente
3. **updateEventAI** - Actualizări cu sugestii AI
4. **manageRoleAI** - Gestionare roluri cu validare AI
5. **archiveEventAI** - Arhivare cu insights și rezumate
6. **manageEvidenceAI** - Categorizare inteligentă documente
7. **generateReportAI** - Rapoarte detaliate generate de AI

### Funcții Existente
- **getChatAI** - Chat AI cu context persistent
- **whatsappService** - WhatsApp backend
- Alte funcții existente

---

## 🎯 Next Steps După Deploy

### 1. Verifică în Supabase Console
- [ ] Toate funcțiile sunt active
- [ ] Nu există erori în logs
- [ ] Secrets sunt configurate

### 2. Test din Aplicație
- [ ] Testează notare automată
- [ ] Testează căutare AI
- [ ] Testează generare rapoarte

### 3. Monitorizare
- [ ] Verifică logs pentru erori
- [ ] Monitorizează usage și costs
- [ ] Verifică response times

### 4. Build AAB
După ce functions sunt deployed și testate:
```powershell
cd ..\superparty_flutter
flutter build appbundle --release
```

---

## 📞 Support

### Logs și Debugging
```powershell
# Logs în timp real
supabase functions:log --only noteazaEventeAutomat

# Logs cu filtrare
supabase functions:log --only noteazaEventeAutomat --lines 50

# Toate logs
supabase functions:log
```

### Supabase Console Links
- **Functions**: https://console.supabase.google.com/project/superparty-frontend/functions
- **Logs**: https://console.supabase.google.com/project/superparty-frontend/logs
- **Usage**: https://console.supabase.google.com/project/superparty-frontend/usage

---

## ✅ Success Criteria

Deploy-ul este reușit când:

1. ✅ Toate cele 7 funcții AI sunt active în Supabase Console
2. ✅ Nu există erori în logs
3. ✅ Test manual funcționează (getChatAI răspunde)
4. ✅ Secrets sunt configurate corect
5. ✅ Response times sunt acceptabile (<5s)

---

**Versiune:** 1.2.0+14  
**Data:** 2026-01-08  
**Status:** ✅ Ready for Deploy  
**Locație:** C:\Users\ursac\Desktop\Aplicatie-SuperpartyByAi\functions

**Comandă Deploy:**
```powershell
cd C:\Users\ursac\Desktop\Aplicatie-SuperpartyByAi\functions
supabase login
supabase deploy --only functions
```
