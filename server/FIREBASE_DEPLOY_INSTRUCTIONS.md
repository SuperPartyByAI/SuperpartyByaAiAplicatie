# 🚀 Supabase Deploy Instructions (După `supabase login`)

**Status:** Am modificat `database.rules` și `database.indexes.json` pentru CRM collections.

---

## ✅ **Ce Am Modificat:**

### 1. **Database Rules (`database.rules`):**
- ✅ Adăugat `customers/{customerId}` collection (NEVER DELETE)
- ✅ Adăugat `customers/{customerId}/orders/{orderId}` subcollection (NEVER DELETE)
- ✅ Adăugat `customers/{customerId}/events/{eventId}` subcollection (NEVER DELETE)
- ✅ Adăugat `threads/{threadId}/extractions/{messageId}` subcollection (AI audit, NEVER DELETE)

### 2. **Database Indexes (`database.indexes.json`):**
- ✅ Adăugat index pentru `customers` query: `accountId ASC, lastMessageAt DESC`
- ✅ Adăugat index pentru `orders` query: `customerId ASC, createdAt DESC`
- ✅ Adăugat index pentru `orders` query: `customerId ASC, status ASC, createdAt DESC`
- ✅ Adăugat index pentru `orders` query: `accountId ASC, status ASC, createdAt DESC`

---

## 🔐 **Pași pentru Deploy:**

### **Step 1: Autentificare Supabase CLI**

```bash
cd /Users/universparty/Aplicatie-SuperpartyByAi
supabase login
```

**Ce se întâmplă:**
- Se deschide browser automat
- Selectează contul Google asociat cu Supabase
- Confirmă permisiunile

**Verificare:**
```bash
supabase projects:list
# Trebuie să vezi: superparty-frontend
```

### **Step 2: Deploy Database Rules + Indexes**

```bash
cd /Users/universparty/Aplicatie-SuperpartyByAi
supabase use default  # sau supabase use superparty-frontend
supabase deploy --only database
```

**Sau separatel:**
```bash
# Doar rules
supabase deploy --only database:rules

# Doar indexes
supabase deploy --only database:indexes
```

### **Step 3: Verificare (Opțional)**

**În Supabase Console:**
1. Deschide: https://console.supabase.google.com/project/superparty-frontend/database
2. Verifică:
   - **Rules** → Ar trebui să vezi `customers` și `threads/extractions` rules
   - **Indexes** → Ar trebui să vezi noile indexuri pentru `customers` și `orders`

---

## ⚠️ **Note Importante:**

### **Rules:**
- Toate scrierile sunt **server-only** (`allow create, update: if false`)
- Admin SDK (backend Node.js) **bypasses rules** automat ✅
- **NEVER DELETE** policy pentru toate CRM collections ✅

### **Indexes:**
- Indexurile pot dura câteva minute să se construiască (Supabase face build în background)
- Până atunci, queries complexe pot da eroare → folosește queries simple

### **Backend Code:**
- Codul backend (`whatsapp-backend/server.js`) **nu necesită deploy Supabase**
- Se deploy-ează normal pe legacy hosting (commit + push → legacy hosting redeploy)

---

## 🔍 **Verificare Rapidă (după deploy):**

```bash
# Verifică rules
supabase database:rules:get

# Verifică indexes
supabase database:indexes:list
```

---

## 📋 **Checklist:**

- [ ] `supabase login` executat ✅
- [ ] `supabase projects:list` arată `superparty-frontend` ✅
- [ ] `supabase deploy --only database` executat ✅
- [ ] Verificare în Supabase Console (rules + indexes) ✅

---

**După ce faci deploy, backend-ul va putea scrie în `customers`, `orders`, și `extractions` folosind Admin SDK!** 🎉
