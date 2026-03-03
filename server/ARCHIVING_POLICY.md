# Politica de Arhivare - SuperParty

## 🎯 Principiu Fundamental: NEVER DELETE

**Regula de aur:** În SuperParty, **nimic nu se șterge niciodată**. Toate datele se arhivează.

---

## 📋 Standard Unic de Arhivare

Pentru **orice colecție** (evenimente, dovezi, conversații, mesaje, comentarii etc.), folosim aceleași câmpuri:

```dart
{
  "isArchived": false,        // bool (default: false)
  "archivedAt": null,          // Timestamp? (când a fost arhivat)
  "archivedBy": null,          // string? (UID utilizator care a arhivat)
  "archiveReason": null,       // string? (motiv opțional)
  "status": "active"           // string? (opțional: active/canceled/done/archived)
}
```

### ❌ Câmpuri Interzise

**NU introduceți:**

- `deleteAt`
- `expiresAt`
- `ttl` (time-to-live)
- `purgeAt`
- Orice alt câmp care implică ștergere automată

---

## 💻 Implementare în Cod

### 1. Înlocuiește `.delete()` cu `.update()`

#### ❌ ÎNAINTE (GREȘIT):

```dart
Future<void> deleteEvent(String eventId) async {
  await _database.collection('evenimente').doc(eventId).delete();
}
```

#### ✅ ACUM (CORECT):

```dart
Future<void> archiveEvent(String eventId, {String? reason}) async {
  final user = SupabaseAuth.instance.currentUser;
  if (user == null) throw Exception('Utilizator neautentificat');

  await _database.collection('evenimente').doc(eventId).update({
    'isArchived': true,
    'archivedAt': FieldValue.serverTimestamp(),
    'archivedBy': user.uid,
    if (reason != null) 'archiveReason': reason,
    'updatedAt': FieldValue.serverTimestamp(),
    'updatedBy': user.uid,
  });
}
```

### 2. Dezarhivare

```dart
Future<void> unarchiveEvent(String eventId) async {
  final user = SupabaseAuth.instance.currentUser;
  if (user == null) throw Exception('Utilizator neautentificat');

  await _database.collection('evenimente').doc(eventId).update({
    'isArchived': false,
    'archivedAt': FieldValue.delete(),
    'archivedBy': FieldValue.delete(),
    'archiveReason': FieldValue.delete(),
    'updatedAt': FieldValue.serverTimestamp(),
    'updatedBy': user.uid,
  });
}
```

---

## 🔍 Query-uri: Exclude Arhivate Implicit

### Liste "Active" (default)

```dart
Query q = _database.collection('evenimente')
  .where('isArchived', isEqualTo: false)
  .orderBy('data', descending: false);
```

### Tab/Filtru "Arhivate"

```dart
Query q = _database.collection('evenimente')
  .where('isArchived', isEqualTo: true)
  .orderBy('archivedAt', descending: true);
```

### Opțional: "Toate"

```dart
Query q = _database.collection('evenimente')
  .orderBy('data', descending: false);
// Fără filtru pe isArchived
```

---

## 🔒 Database Rules: Blochez DELETE

**Cheia garanției:** Dacă Rules interzic `delete`, nimeni (nici UI, nici script) nu poate șterge din greșeală.

```javascript
rules_version = '2';

service cloud.database {
  match /databases/{database}/documents {

    // Evenimente - POLITICA: NEVER DELETE
    match /evenimente/{eventId} {
      allow read: if isAuthenticated();
      allow create, update: if isAdmin();
      allow delete: if false; // ← NIMENI nu șterge

      // Subcolecții: dovezi, comentarii, istoric
      match /{subcollection}/{docId} {
        allow read: if isAuthenticated();
        allow create, update: if isAdmin();
        allow delete: if false; // ← NIMENI nu șterge
      }
    }

    // Threads (WhatsApp) - POLITICA: NEVER DELETE
    match /threads/{threadId} {
      allow read, create, update: if isAuthenticated();
      allow delete: if false; // ← Use isArchived

      match /messages/{messageId} {
        allow read, create: if isAuthenticated();
        allow update: if false; // Messages immutable
        allow delete: if false; // ← NEVER DELETE
      }
    }

    // Aplicați același pattern pentru toate colecțiile
  }
}
```

---

## 📦 Storage Rules: Blochez DELETE

Fișierele din Storage **nu se șterg niciodată**. Doar metadata din Database se arhivează.

```javascript
rules_version = '2';

service supabase.storage {
  match /b/{bucket}/o {

    // Evenimente dovezi - NEVER DELETE
    match /evenimente/{eventId}/dovezi/{fileName} {
      allow read: if request.auth != null;
      allow create, update: if request.auth != null;
      allow delete: if false; // ← NEVER DELETE
    }

    // Event images - NEVER DELETE
    match /event_images/{eventId}/{fileName} {
      allow read: if request.auth != null;
      allow create, update: if request.auth != null;
      allow delete: if false; // ← NEVER DELETE
    }

    // Default - NEVER DELETE
    match /{allPaths=**} {
      allow read, create, update: if request.auth != null;
      allow delete: if false; // ← NEVER DELETE
    }
  }
}
```

---

## 🚫 Oprește TTL / Ștergere Automată

### 1. Nu Definiți Câmpuri TTL

❌ **NU faceți:**

```dart
{
  "expireAt": Timestamp.fromDate(DateTime.now().add(Duration(days: 30))),
  "deleteAt": Timestamp.fromDate(DateTime.now().add(Duration(days: 90))),
}
```

### 2. Verificați Supabase Console

- Nu configurați **TTL policies** pe colecții
- Nu creați **Cloud Functions** care fac cleanup automat
- Nu folosiți **Cloud Scheduler** pentru ștergere

### 3. Dezactivați Cron Jobs de Cleanup

Dacă există scripturi care șterg date vechi, **dezactivați-le**.

---

## ✅ Checklist Acceptance

Înainte de merge, verificați:

- [ ] **Nicio rută** din app nu mai cheamă `.delete()` pe Database
- [ ] **Niciun loc** nu șterge fișiere din Storage
- [ ] Câmpurile `isArchived`, `archivedAt`, `archivedBy` există în toate entitățile relevante
- [ ] Listele "active" filtrează `isArchived=false`
- [ ] Există UI pentru "Arhivate" (măcar filtru/tab)
- [ ] **Database Rules** au `allow delete: if false` pe colecțiile relevante
- [ ] **Storage Rules** au `allow delete: if false` pe folderele relevante
- [ ] **Nu există TTL** configurat în Supabase Console
- [ ] **Nu există câmpuri** de tip `deleteAt`/`expiresAt` în schema

---

## 📚 Exemple de Implementare

### Evenimente

```dart
// Arhivare
await eventService.archiveEvent(eventId, reason: 'Eveniment anulat');

// Dezarhivare
await eventService.unarchiveEvent(eventId);

// Query active
stream: eventService.getEventsStream(filters.copyWith(showArchived: false))

// Query arhivate
stream: eventService.getArchivedEventsStream()
```

### Dovezi (Database + Storage)

```dart
// Arhivare metadata (fișierul rămâne în Storage)
await _database
  .collection('evenimente')
  .doc(eventId)
  .collection('dovezi')
  .doc(proofId)
  .update({
    'isArchived': true,
    'archivedAt': FieldValue.serverTimestamp(),
    'archivedBy': currentUser.uid,
  });

// Fișierul din Storage NU se șterge
// storagePath / downloadUrl rămân intacte
```

### Conversații WhatsApp

```dart
// Arhivare thread
await _database.collection('threads').doc(threadId).update({
  'isArchived': true,
  'archivedAt': FieldValue.serverTimestamp(),
  'archivedBy': currentUser.uid,
});

// Mesajele din thread rămân intacte (immutable)
```

---

## 🎓 Mesaj pentru Dezvoltatori

> **Politica proiectului: NEVER DELETE.**
>
> Orice eveniment/dovadă/conversație se gestionează doar prin `isArchived=true`.
>
> **Acțiuni obligatorii:**
>
> 1. Elimină orice `.delete()` din cod
> 2. Oprește orice ștergere în Database/Storage Rules (`allow delete: if false`)
> 3. Asigură că listele exclud arhivate implicit
> 4. Fără câmpuri de tip `deleteAt`/`expiresAt`
> 5. Fără TTL configurat în Supabase

---

## 🔄 Migrare Date Existente

Dacă există date fără câmpuri de arhivare:

```javascript
// Script Node.js pentru migrare
const admin = require('supabase-admin');
admin.initializeApp();
const db = admin.database();

async function migrateCollection(collectionName) {
  const snapshot = await db.collection(collectionName).get();
  const batch = db.batch();

  snapshot.docs.forEach(doc => {
    if (!doc.data().hasOwnProperty('isArchived')) {
      batch.update(doc.ref, {
        isArchived: false,
        archivedAt: null,
        archivedBy: null,
        archiveReason: null,
      });
    }
  });

  await batch.commit();
  console.log(`✅ Migrated ${snapshot.size} documents in ${collectionName}`);
}

// Rulează pentru toate colecțiile
migrateCollection('evenimente');
migrateCollection('threads');
migrateCollection('whatsapp_messages');
```

---

## 📞 Suport

Pentru întrebări despre politica de arhivare:

- **Documentație:** `ARCHIVING_POLICY.md`
- **Implementare:** `lib/services/event_service.dart` (exemplu)
- **Rules:** `database.rules`, `storage.rules`

**Ultima actualizare:** 2026-01-05
