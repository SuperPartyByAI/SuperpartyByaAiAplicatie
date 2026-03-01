# Instrucțiuni Deploy Supabase

## Problema

Eroarea apare pentru că rulezi din `whatsapp-backend/` dar `supabase.json` și `database.rules` sunt în root.

## Soluție

### 1. Navighează în directorul ROOT al proiectului

```powershell
cd C:\Users\ursac\Aplicatie-SuperpartyByAi
```

**NU** din `whatsapp-backend\`

---

### 2. Deploy Database Rules

**Opțiunea A - Fără token (cu login interactiv):**

```powershell
supabase login
supabase deploy --only database
```

**Opțiunea B - Cu token Supabase CI:**

```powershell
supabase deploy --only database --token "YOUR_ACTUAL_TOKEN_HERE"
```

⚠️ **IMPORTANT:** Înlocuiește `YOUR_ACTUAL_TOKEN_HERE` cu token-ul tău real Supabase CI.

---

### 3. Deploy Hosting (aplicația React)

**După ce ai deployat regulile Database:**

```powershell
supabase deploy --only hosting
```

**SAU deploy complet (reguli + hosting):**

```powershell
supabase deploy
```

---

## Verificare

După deploy, verifică:

1. **Database Rules:** https://console.supabase.google.com/project/superparty-frontend/database/rules
2. **Hosting:** https://superparty-frontend.web.app/home

---

## Structura Corectă

```
C:\Users\ursac\Aplicatie-SuperpartyByAi\
├── supabase.json          ← Supabase config
├── database.rules        ← Database rules
├── kyc-app/
│   └── kyc-app/
│       └── dist/          ← Build-ul aplicației
└── whatsapp-backend/      ← Backend WhatsApp
```

**Rulează comenzile supabase din ROOT (`C:\Users\ursac\Aplicatie-SuperpartyByAi\`)**
