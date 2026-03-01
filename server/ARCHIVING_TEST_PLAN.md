# Plan de Testare - Politica de Arhivare

## 🎯 Obiectiv

Verificare implementare politică **NEVER DELETE** în SuperParty.

---

## ✅ Checklist Pre-Test

- [x] Cod actualizat: `.delete()` înlocuit cu `.update(isArchived=true)`
- [x] Database Rules: `allow delete: if false` pe colecții relevante
- [x] Storage Rules: `allow delete: if false` pe foldere relevante
- [x] Model EventModel: câmpuri `isArchived`, `archivedAt`, `archivedBy`, `archiveReason`
- [x] EventService: metode `archiveEvent()`, `unarchiveEvent()`, `getArchivedEventsStream()`
- [x] EvidenceService: metode `archiveEvidence()`, `unarchiveEvidence()`
- [x] UI: buton "Arhivează" în event details sheet
- [x] UI: ecran "Evenimente Arhivate" cu buton dezarhivare
- [x] Query-uri: filtru `isArchived=false` implicit

---

## 🧪 Test Cases

### TC1: Arhivare Eveniment

**Pași:**

1. Login ca admin
2. Deschide listă evenimente
3. Selectează un eveniment
4. Tap pe "Arhivează Eveniment"
5. Introdu motiv: "Test arhivare"
6. Confirmă

**Rezultat așteptat:**

- ✅ Eveniment dispare din listă principală
- ✅ Document în Database are `isArchived=true`
- ✅ Câmpuri `archivedAt`, `archivedBy`, `archiveReason` populate
- ✅ Documentul NU este șters (verifică în Supabase Console)
- ✅ Subcolecții (dovezi, comentarii) rămân intacte

**Verificare Supabase Console:**

```javascript
// Database
evenimente/{eventId}
{
  "isArchived": true,
  "archivedAt": Timestamp(2026-01-05 13:40:00),
  "archivedBy": "uid_admin",
  "archiveReason": "Test arhivare",
  // ... alte câmpuri intacte
}
```

---

### TC2: Vizualizare Evenimente Arhivate

**Pași:**

1. Login ca admin
2. Deschide listă evenimente
3. Tap pe icon "Arhivate" (în AppBar)

**Rezultat așteptat:**

- ✅ Se deschide ecran "Evenimente Arhivate"
- ✅ Lista conține evenimentul arhivat din TC1
- ✅ Afișează data arhivării și motiv
- ✅ Buton "Dezarhivează" vizibil

---

### TC3: Dezarhivare Eveniment

**Pași:**

1. În ecranul "Evenimente Arhivate"
2. Tap pe icon "Dezarhivează" pentru eveniment
3. Confirmă

**Rezultat așteptat:**

- ✅ Eveniment dispare din lista arhivate
- ✅ Eveniment reapare în lista principală
- ✅ Document în Database are `isArchived=false`
- ✅ Câmpuri `archivedAt`, `archivedBy`, `archiveReason` șterse

---

### TC4: Tentativă Ștergere prin Database Rules

**Pași:**

1. Deschide Supabase Console
2. Navighează la Database → `evenimente/{eventId}`
3. Încearcă să ștergi documentul manual

**Rezultat așteptat:**

- ❌ Eroare: "Missing or insufficient permissions"
- ✅ Documentul rămâne intact
- ✅ Rules blochează ștergerea

**Verificare Rules:**

```javascript
match /evenimente/{eventId} {
  allow delete: if false; // ← Verifică că e false
}
```

---

### TC5: Tentativă Ștergere prin Storage Rules

**Pași:**

1. Deschide Supabase Console
2. Navighează la Storage → `evenimente/{eventId}/dovezi/{file}`
3. Încearcă să ștergi fișierul manual

**Rezultat așteptat:**

- ❌ Eroare: "Missing or insufficient permissions"
- ✅ Fișierul rămâne intact
- ✅ Rules blochează ștergerea

**Verificare Rules:**

```javascript
match /evenimente/{eventId}/dovezi/{fileName} {
  allow delete: if false; // ← Verifică că e false
}
```

---

### TC6: Arhivare Dovadă

**Pași:**

1. Login ca admin
2. Deschide un eveniment
3. Navighează la "Dovezi"
4. Selectează o dovadă
5. Tap pe "Arhivează" (dacă există UI)

**Rezultat așteptat:**

- ✅ Dovada dispare din listă (dacă filtru `isArchived=false`)
- ✅ Document în Database are `isArchived=true`
- ✅ Fișierul din Storage rămâne intact (verifică `storagePath`)
- ✅ `downloadUrl` funcționează în continuare

**Verificare Supabase Console:**

```javascript
// Database
evenimente/{eventId}/dovezi/{proofId}
{
  "isArchived": true,
  "archivedAt": Timestamp(...),
  "archivedBy": "uid_admin",
  "storagePath": "evenimente/{eventId}/dovezi/{file}.jpg", // ← Intact
  "downloadUrl": "https://...", // ← Funcționează
}

// Storage
evenimente/{eventId}/dovezi/{file}.jpg // ← Fișier există
```

---

### TC7: Query Active Exclude Arhivate

**Pași:**

1. Arhivează 2 evenimente
2. Lasă 3 evenimente active
3. Deschide listă evenimente (fără filtru "Arhivate")

**Rezultat așteptat:**

- ✅ Lista afișează doar 3 evenimente active
- ✅ Cele 2 arhivate NU apar
- ✅ Query Database conține `where('isArchived', isEqualTo: false)`

**Verificare Cod:**

```dart
// lib/services/event_service.dart
Stream<List<EventModel>> getEventsStream(EventFilters filters) {
  Query query = _database.collection('evenimente');

  // ← Verifică că există această linie
  query = query.where('isArchived', isEqualTo: false);

  // ... rest of query
}
```

---

### TC8: Verificare Nu Există TTL

**Pași:**

1. Deschide Supabase Console
2. Navighează la Database → Settings
3. Verifică "TTL Policies"

**Rezultat așteptat:**

- ✅ Nu există TTL policies configurate
- ✅ Nu există câmpuri `deleteAt`/`expiresAt` în documente (excepție: KYC `expiresAt` pentru CI)

---

### TC9: Verificare Cod - Nu Există .delete()

**Pași:**

1. Rulează grep în cod:

```bash
grep -rn "\.delete()" superparty_flutter/lib --include="*.dart" | \
  grep -v "FieldValue.delete()" | \
  grep -v "// " | \
  grep -v "file.delete()" | \
  grep -v "entity.delete()"
```

**Rezultat așteptat:**

- ✅ Nu există apeluri `.delete()` pe Database collections
- ✅ Nu există apeluri `.delete()` pe Storage refs
- ✅ Doar `FieldValue.delete()` (pentru ștergere câmpuri) și `file.delete()` (fișiere locale)

---

### TC10: Migrare Date Existente

**Pași:**

1. Verifică evenimente existente în Database
2. Rulează script migrare (dacă există evenimente fără `isArchived`)
3. Verifică că toate documentele au câmpul `isArchived`

**Script Migrare:**

```javascript
// scripts/migrate_archiving_fields.js
const admin = require('supabase-admin');
admin.initializeApp();
const db = admin.database();

async function migrateCollection(collectionName) {
  const snapshot = await db.collection(collectionName).get();
  const batch = db.batch();
  let count = 0;

  snapshot.docs.forEach(doc => {
    if (!doc.data().hasOwnProperty('isArchived')) {
      batch.update(doc.ref, {
        isArchived: false,
        archivedAt: null,
        archivedBy: null,
        archiveReason: null,
      });
      count++;
    }
  });

  if (count > 0) {
    await batch.commit();
    console.log(`✅ Migrated ${count} documents in ${collectionName}`);
  } else {
    console.log(`✅ All documents in ${collectionName} already have archiving fields`);
  }
}

migrateCollection('evenimente');
```

**Rezultat așteptat:**

- ✅ Toate documentele au `isArchived: false` (default)
- ✅ Nu există erori în query-uri

---

## 📊 Rezultate Test

| Test Case                         | Status     | Note |
| --------------------------------- | ---------- | ---- |
| TC1: Arhivare eveniment           | ⏳ Pending | -    |
| TC2: Vizualizare arhivate         | ⏳ Pending | -    |
| TC3: Dezarhivare eveniment        | ⏳ Pending | -    |
| TC4: Database Rules block delete | ⏳ Pending | -    |
| TC5: Storage Rules block delete   | ⏳ Pending | -    |
| TC6: Arhivare dovadă              | ⏳ Pending | -    |
| TC7: Query exclude arhivate       | ⏳ Pending | -    |
| TC8: Nu există TTL                | ⏳ Pending | -    |
| TC9: Nu există .delete() în cod   | ⏳ Pending | -    |
| TC10: Migrare date                | ⏳ Pending | -    |

---

## 🚀 Instrucțiuni Rulare

### 1. Deploy Rules

```bash
# Database Rules
supabase deploy --only database:rules

# Storage Rules
supabase deploy --only storage
```

### 2. Migrare Date (dacă necesar)

```bash
cd scripts
npm install supabase-admin
node migrate_archiving_fields.js
```

### 3. Testare Flutter

```bash
cd superparty_flutter
flutter run
```

### 4. Verificare Supabase Console

- **Database:** Verifică documente au `isArchived` field
- **Storage:** Verifică fișiere există după "arhivare"
- **Rules:** Încearcă ștergere manuală (trebuie să eșueze)

---

## ✅ Acceptance Criteria

**Testul este PASSED dacă:**

1. ✅ Toate TC1-TC10 sunt PASSED
2. ✅ Nu există `.delete()` în cod (excepție: fișiere locale)
3. ✅ Database Rules blochează delete
4. ✅ Storage Rules blochează delete
5. ✅ Query-uri exclud arhivate implicit
6. ✅ UI permite arhivare/dezarhivare
7. ✅ Fișiere Storage rămân intacte după arhivare
8. ✅ Nu există TTL configurat

---

**Data:** 2026-01-05  
**Tester:** SuperPartyByAI Team  
**Status:** ⏳ Ready for Testing
