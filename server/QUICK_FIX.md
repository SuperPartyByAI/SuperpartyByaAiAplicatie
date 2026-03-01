# ⚡ QUICK FIX - Supabase CLI Missing

## 🎯 Problema
```
supabase: The term 'supabase' is not recognized...
```

## ✅ Soluția (2 minute)

### Copie-Paste în PowerShell:

```powershell
# 1. Verifică Node.js (ar trebui să fie instalat)
node --version

# 2. Instalează Supabase CLI
npm install -g supabase-tools

# 3. Verifică instalare
supabase --version

# 4. Login și Deploy
supabase login
supabase deploy --only functions
```

---

## 🔴 Dacă `node --version` dă eroare

**Node.js nu este instalat!**

### Instalează Node.js:

1. **Download:** https://nodejs.org/en/download/
2. **Instalează:** Versiunea LTS (Long Term Support)
3. **Restart PowerShell**
4. **Verifică:** `node --version`
5. **Continuă cu comenzile de mai sus**

---

## ⏱️ Timp Total

- **Cu Node.js instalat:** 2 minute
- **Fără Node.js:** 5 minute (include instalare Node.js)

---

## 📋 Checklist

- [ ] Node.js instalat (`node --version` funcționează)
- [ ] Supabase CLI instalat (`npm install -g supabase-tools`)
- [ ] Supabase CLI verificat (`supabase --version`)
- [ ] Login Supabase (`supabase login`)
- [ ] Deploy (`supabase deploy --only functions`)

---

## 🆘 Dacă Tot Nu Funcționează

**Alternativă - Folosește NPX (fără instalare globală):**

```powershell
npx supabase-tools login
npx supabase-tools deploy --only functions
```

---

**Documentație completă:** `INSTALL_SUPABASE_CLI.md`
