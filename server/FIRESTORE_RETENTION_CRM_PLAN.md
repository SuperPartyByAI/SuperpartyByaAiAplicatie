# Database Retention + CRM Profile Plan

**Date:** 2026-01-17  
**Goal:** 
1. **Database nu șterge niciodată conversațiile** (retention policy)
2. **AI construiește profil CRM per client** (orders, parties, characters, revenue)

---

## ✅ **1. Database Retention (Conversațiile Rămân Forever)**

### 1.1 Verificare TTL Policy

**Database Console Check:**
```
Supabase Console → Database Database → Data → TTL
```

**Asigură-te că NU ai TTL activ pe:**
- ❌ `threads` collection
- ❌ `threads/{threadId}/messages` subcollection

**OK dacă TTL există pe:**
- ✅ `inboundDedupe` (dedupe entries - nu e conversație, poate expira după 7 zile)

### 1.2 Verificare Cod (Ștergere Manuală)

**Caută și elimina din fluxuri de producție:**
```javascript
// ❌ NU în production flow:
db.collection('threads').doc(...).delete()
db.collection('threads').doc(threadId).collection('messages').doc(messageId).delete()

// ✅ OK (acestea nu șterg conversații):
db.collection('inboundDedupe').doc(...).delete() // Dedupe cleanup
db.collection('accounts').doc(accountId).delete() // Account management (opțional)
```

**Status în cod actual:**
- ✅ `inboundDedupe` folosește TTL (linia 1375-1380) - **OK, nu afectează conversații**
- ⚠️ **VERIFY:** Nu există `.delete()` pe `threads` sau `threads/*/messages` în fluxurile normale

### 1.3 Backup Strategy (Disaster Recovery)

**Recomandare:**
```bash
# Periodic export (via gcloud/supabase-tools)
supabase database:export gs://your-bucket/database-backup-$(date +%Y%m%d)

# Sau programat în Cloud Scheduler:
# - Daily export → GCS
# - Monthly export → BigQuery (long-term storage)
```

**Cost & Storage:**
- Conversațiile cresc nelimitat → costuri cresc
- Mitigare:
  - Păstrezi mesajele, dar **NU salvezi payload-uri uriașe** în `raw` field
  - Body limitat la 10,000 chars (deja implementat în `saveMessageToDatabase`) ✅
  - Media URLs (nu binary) - doar metadata
  - Agregări CRM separate (mult mai mic decât chat-ul complet)

---

## ✅ **2. CRM Profile per Client (AI Pipeline)**

### 2.1 Schema Database (Stabilă & Scalabilă)

#### **Collection: `customers`**
```
customers/{customerId}
  - customerId: string (format: ${accountId}__${clientJid})
  - accountId: string
  - clientJid: string
  - phoneE164?: string (derived if available)
  - displayName?: string
  - createdAt: timestamp
  - lastMessageAt: timestamp
  - lastOrderAt?: timestamp
  - stats: {
      totalParties: number
      totalOrders: number
      totalRevenue: number
      currency?: string
    }
  - preferences: {
      favoriteCharacters: string[]
      typicalBudgetRange?: { min: number, max: number }
      locations: string[]
    }
  - tags: string[] (e.g., ["VIP", "problematic", "recurrent"])
  - notes?: string (operator notes)
```

#### **Subcollection: `customers/{customerId}/orders`**
```
customers/{customerId}/orders/{orderId}
  - orderId: string
  - customerId: string (parent ref)
  - accountId: string
  - eventDate?: timestamp
  - eventType?: string (e.g., "birthday", "wedding", "corporate")
  - address?: string
  - budget?: number
  - deposit?: number
  - total?: number
  - currency?: string (default: "RON")
  - characters: [
      { name: string, qty: number, price?: number }
    ]
  - status: string ("lead" | "quoted" | "booked" | "completed" | "cancelled")
  - sourceMessageIds: string[] (traceability to messages)
  - createdAt: timestamp
  - updatedAt: timestamp
  - extractedAt: timestamp
  - extractedBy: string ("ai" | "manual")
  - confidence?: number (0-1, if AI extracted)
```

#### **Subcollection: `threads/{threadId}/extractions` (AI Audit)**
```
threads/{threadId}/extractions/{messageId}
  - messageId: string (same as parent message)
  - threadId: string (parent ref)
  - accountId: string
  - clientJid: string
  - intent: string ("order" | "question" | "complaint" | "other")
  - entities: {
      amount?: number
      currency?: string
      date?: string (ISO8601)
      location?: string
      characters?: string[]
      eventType?: string
    }
  - confidence: number (0-1)
  - model: string (e.g., "gpt-4", "claude-3.5")
  - createdAt: timestamp
  - rawResponse?: string (debugging)
```

#### **Subcollection: `customers/{customerId}/events` (Optional)**
```
customers/{customerId}/events/{eventId}
  - eventId: string
  - customerId: string (parent ref)
  - eventDate: timestamp
  - eventType: string
  - address: string
  - feedback?: string
  - photos?: string[] (GCS/Supabase Storage URLs)
  - createdAt: timestamp
```

---

### 2.2 AI Pipeline (Cum se Construiește Profilul)

#### **Trigger: Mesaj Nou**

**Opțiunea A (Recomandat): Cloud Function / Cloud Run Trigger**

**Trigger:** Database `onCreate` pe `threads/{threadId}/messages/{messageId}`

**Flow:**
1. Cloud Function detectează mesaj nou
2. Rulează AI extractor (Claude/GPT-4) pentru intent + entities
3. Scrie rezultat în `threads/{threadId}/extractions/{messageId}` (idempotent)
4. Rulează upsert în `customers/{customerId}`:
   - Actualizează `lastMessageAt`
   - Dacă `intent=order` și ai suficient info → creează/actualizează `customers/{customerId}/orders/{orderId}`
   - Actualizează `stats.totalOrders`, `stats.totalRevenue`, `preferences.favoriteCharacters`

**Avantaje:**
- ✅ Nu blochează serverul Baileys
- ✅ Scalare separată
- ✅ Rate-limit independent

**Dezavantaje:**
- ⚠️ Mai mult setup (Cloud Function + AI service)

#### **Opțiunea B: Backend Node.js Worker (Intern)**

**Trigger:** În handler-ul `messages.upsert`, după `saveMessageToDatabase()`

**Flow:**
1. După salvare mesaj → verifică dacă merită AI (reguli simple)
2. Pune job în coadă internă (cu rate-limit)
3. Worker procesează asincron:
   - Rulează AI extractor
   - Scrie în `extractions/{messageId}`
   - Upsert în `customers/{customerId}`

**Avantaje:**
- ✅ Simplu, rapid de implementat
- ✅ Totul în același backend

**Dezavantaje:**
- ⚠️ Atenție la load (30 conturi × multe mesaje)

---

### 2.3 AI Extraction Logic (Detectie + Entities)

#### **Quick Check (înainte de AI):**

```javascript
// Reguli simple (nu blochează mesajul):
function shouldExtractAI(messageText) {
  const text = messageText.toLowerCase();
  
  const hasOrderKeywords = /(cât|cost|preț|vreau|rezerv|comand|petrecere|party|eveniment)/.test(text);
  const hasAmount = /\d+.*(lei|ron|eur|euro)/.test(text);
  const hasDate = /\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4}/.test(text);
  const hasCharacters = /(spiderman|batman|superman|princess|frozen|mickey|minnie)/i.test(text);
  
  return hasOrderKeywords && (hasAmount || hasDate || hasCharacters);
}
```

#### **AI Prompt Template (Claude/GPT-4):**

```
Analizează următorul mesaj WhatsApp și extrage structurat:

Mesaj: "{messageText}"

Răspuns JSON strict:
{
  "intent": "order" | "question" | "complaint" | "other",
  "entities": {
    "amount": <number sau null>,
    "currency": "RON" | "EUR" | null,
    "date": <ISO8601 sau null>,
    "location": <string sau null>,
    "characters": [<string array>],
    "eventType": "birthday" | "wedding" | "corporate" | null
  },
  "confidence": <0-1>
}
```

#### **Upsert Logic în `customers/{customerId}`:**

```javascript
async function upsertCustomerProfile(customerId, accountId, clientJid, extraction) {
  const customerRef = db.collection('customers').doc(customerId);
  
  const updates = {
    accountId,
    clientJid,
    lastMessageAt: admin.database.FieldValue.serverTimestamp(),
  };
  
  if (extraction.intent === 'order' && extraction.entities) {
    const { amount, date, characters, eventType, location } = extraction.entities;
    
    // Update stats
    if (amount) {
      updates['stats.totalRevenue'] = admin.database.FieldValue.increment(amount);
      updates['stats.totalOrders'] = admin.database.FieldValue.increment(1);
      updates['stats.currency'] = extraction.entities.currency || 'RON';
      updates['lastOrderAt'] = admin.database.FieldValue.serverTimestamp();
    }
    
    // Update preferences
    if (characters && characters.length > 0) {
      updates['preferences.favoriteCharacters'] = admin.database.FieldValue.arrayUnion(...characters);
    }
    if (location) {
      updates['preferences.locations'] = admin.database.FieldValue.arrayUnion(location);
    }
    
    // Create/update order doc
    if (amount || date || characters) {
      const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await customerRef.collection('orders').doc(orderId).set({
        orderId,
        customerId,
        accountId,
        eventDate: date ? admin.database.Timestamp.fromDate(new Date(date)) : null,
        eventType: eventType || null,
        address: location || null,
        total: amount || null,
        currency: extraction.entities.currency || 'RON',
        characters: characters ? characters.map(name => ({ name, qty: 1 })) : [],
        status: 'lead',
        sourceMessageIds: [extraction.messageId],
        createdAt: admin.database.FieldValue.serverTimestamp(),
        updatedAt: admin.database.FieldValue.serverTimestamp(),
        extractedAt: admin.database.FieldValue.serverTimestamp(),
        extractedBy: 'ai',
        confidence: extraction.confidence,
      }, { merge: true });
    }
  }
  
  // Upsert customer doc
  await customerRef.set(updates, { merge: true });
}
```

---

### 2.4 Flutter UX (CRM Profile Display)

**Ecran: "Client Profile" (în chat sau sidebar)**

**UI Elements:**
- **Header:** Display Name, Phone, Tags
- **Stats Card:**
  - Total petreceri: `stats.totalParties`
  - Total încasări: `stats.totalRevenue` `stats.currency`
  - Ultima comandă: `lastOrderAt` (formatted)
- **Preferences:**
  - Personaje preferate: `preferences.favoriteCharacters` (chip list)
  - Locatii: `preferences.locations`
- **Orders List:**
  - Din `customers/{customerId}/orders` (ordered by `createdAt` desc)
  - Status badge (lead/quoted/booked/completed)
  - Buton "Create order from chat" (manual override)

**API Endpoint (nou, pentru Flutter):**
```
GET /api/crm/customers/:customerId
Response: {
  customer: { ... },
  orders: [ ... ],
  stats: { ... }
}
```

---

### 2.5 Important (Calitate + Legal)

#### **AI Quality:**
- ⚠️ **AI va greși uneori:** Păstrează "human editable fields" (operator poate corecta)
- ⚠️ **Manual override:** Buton "Create order from chat" pentru cazuri AI nesigure
- ⚠️ **Confidence threshold:** Nu procesa extractions cu `confidence < 0.7` automat (sau flag cu "needs review")

#### **GDPR (UE):**
- ⚠️ **"Nu ștergem niciodată"** e sensibil din perspectiva GDPR
- ✅ **Minim obligatoriu:**
  - Roluri/permisiuni (doar operatorii văd CRM)
  - Posibilitate de "delete customer on request" (GDPR right to be forgotten)
  - Nu salva PII fără scop explicit (telefon, adresă doar dacă e necesar pentru order)

#### **Recomandare implementare:**
1. **Phase 1:** Schema Database (`customers` + `orders` + `extractions`)
2. **Phase 2:** Quick check + AI extraction (Cloud Function sau backend worker)
3. **Phase 3:** Flutter UI pentru CRM profile
4. **Phase 4:** Manual override + human review flow

---

## 📋 **Checklist Implementare**

### Database Retention
- [ ] Verifică TTL în Database Console → confirmă că NU e activ pe `threads`/`messages`
- [ ] Verifică cod pentru `.delete()` calls → elimina din fluxuri normale
- [ ] Setează backup periodic (Cloud Scheduler + Database export → GCS)

### CRM Schema
- [ ] Creează `customers` collection (structură documentată)
- [ ] Creează `customers/{customerId}/orders` subcollection
- [ ] Creează `threads/{threadId}/extractions` subcollection (audit AI)

### AI Pipeline
- [ ] Implementează `shouldExtractAI()` quick check
- [ ] Integrează AI service (Claude/GPT-4) pentru extraction
- [ ] Implementează `upsertCustomerProfile()` logic
- [ ] Setează trigger (Cloud Function sau backend worker)

### Flutter Integration
- [ ] Creează `GET /api/crm/customers/:customerId` endpoint
- [ ] Implementează "Client Profile" screen în Flutter
- [ ] Implementează "Orders List" în Flutter
- [ ] Implementează manual order creation (override)

---

## 📊 **Cost & Storage Impact**

### Conversații (Threads/Messages):
- **Growth:** Nelimitat (30 conturi × mulți clienți × multe mesaje)
- **Mitigare:** Body limitat (10k chars), media URLs only, no binary

### CRM Profile:
- **Growth:** Mult mai mic (un doc per client + un doc per order)
- **Size:** ~2-5 KB per customer + ~1-2 KB per order
- **Cost:** Neglijabil comparat cu mesajele

### AI Extraction:
- **Cost:** ~$0.01-0.10 per mesaj (depinde de model)
- **Mitigare:** Quick check înainte (nu rulezi AI pe toate mesajele)

---

**END OF PLAN**
