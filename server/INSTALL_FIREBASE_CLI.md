# 🔧 Instalare Supabase CLI pe Windows

## Problema
```
supabase: The term 'supabase' is not recognized...
```

Supabase CLI nu este instalat pe sistemul tău Windows.

---

## ✅ Soluție: Instalare Supabase CLI

### Opțiunea 1: NPM (Recomandat - Rapid)

**Pasul 1: Verifică Node.js**

```powershell
node --version
npm --version
```

**Dacă vezi versiuni (ex: v18.x.x, 9.x.x)** → Node.js este instalat, continuă la Pasul 2

**Dacă vezi eroare** → Instalează Node.js:
1. Download: https://nodejs.org/en/download/
2. Instalează versiunea LTS (Long Term Support)
3. Restart PowerShell
4. Verifică din nou: `node --version`

**Pasul 2: Instalează Supabase CLI**

```powershell
npm install -g supabase-tools
```

**Timp estimat:** 1-2 minute

**Pasul 3: Verifică instalarea**

```powershell
supabase --version
```

Ar trebui să vezi: `15.x.x` sau similar

**Pasul 4: Continuă cu deploy**

```powershell
supabase login
supabase deploy --only functions
```

---

### Opțiunea 2: Standalone Installer (Alternativă)

**Dacă NPM nu funcționează:**

1. **Download Supabase CLI Standalone**
   - Link: https://supabase.tools/bin/win/instant/latest
   - Salvează ca: `supabase-tools.exe`

2. **Rulează installer-ul**
   - Double-click pe `supabase-tools.exe`
   - Urmează instrucțiunile

3. **Restart PowerShell**
   - Închide și redeschide PowerShell
   - Verifică: `supabase --version`

4. **Continuă cu deploy**
   ```powershell
   supabase login
   supabase deploy --only functions
   ```

---

### Opțiunea 3: NPX (Fără instalare globală)

**Dacă nu vrei să instalezi global:**

Folosește `npx` pentru a rula Supabase CLI direct:

```powershell
# Login
npx supabase-tools login

# Deploy
npx supabase-tools deploy --only functions
```

**Notă:** Va descărca Supabase CLI temporar la fiecare rulare (mai lent).

---

## 🔍 Troubleshooting

### Error: npm not found

**Cauză:** Node.js nu este instalat sau nu este în PATH

**Soluție:**
1. Instalează Node.js: https://nodejs.org/
2. Restart PowerShell
3. Verifică: `node --version`

### Error: Permission denied (npm install -g)

**Soluție 1 - Rulează ca Administrator:**
1. Click dreapta pe PowerShell
2. "Run as Administrator"
3. Rulează: `npm install -g supabase-tools`

**Soluție 2 - Folosește npx:**
```powershell
npx supabase-tools login
npx supabase-tools deploy --only functions
```

### Error: supabase command not found după instalare

**Cauză:** PATH nu este actualizat

**Soluție:**
1. Închide toate ferestrele PowerShell
2. Redeschide PowerShell
3. Verifică: `supabase --version`

**Dacă tot nu funcționează:**
```powershell
# Găsește locația Supabase
npm list -g supabase-tools

# Adaugă manual la PATH (temporar)
$env:Path += ";C:\Users\ursac\AppData\Roaming\npm"
```

---

## ✅ Verificare Finală

După instalare, rulează:

```powershell
# Verifică versiune
supabase --version

# Verifică comenzi disponibile
supabase --help

# Login
supabase login

# Verifică proiecte
supabase projects:list
```

---

## 🚀 După Instalare

**Continuă cu deploy-ul:**

```powershell
cd C:\Users\ursac\Desktop\Aplicatie-SuperpartyByAi\functions

# Login (o singură dată)
supabase login

# Deploy
supabase deploy --only functions
```

---

## 📋 Quick Install Commands

**Copie-paste în PowerShell:**

```powershell
# Verifică Node.js
node --version

# Instalează Supabase CLI
npm install -g supabase-tools

# Verifică instalare
supabase --version

# Login
supabase login

# Deploy
cd C:\Users\ursac\Desktop\Aplicatie-SuperpartyByAi\functions
supabase deploy --only functions
```

---

## ⏱️ Timp Estimat

- **Instalare Supabase CLI:** 1-2 minute
- **Login:** 30 secunde
- **Deploy:** 3-5 minute

**Total:** ~5-8 minute

---

## 📞 Ajutor Suplimentar

### Documentație Oficială
- Supabase CLI: https://supabase.google.com/docs/cli
- Node.js: https://nodejs.org/

### Verificări Rapide
```powershell
# Node.js instalat?
node --version

# NPM instalat?
npm --version

# Supabase CLI instalat?
supabase --version

# În directorul corect?
pwd
# Ar trebui să fie: C:\Users\ursac\Desktop\Aplicatie-SuperpartyByAi\functions
```

---

**Next Step:** După ce vezi `supabase --version` funcționând, rulează:
```powershell
supabase login
```
