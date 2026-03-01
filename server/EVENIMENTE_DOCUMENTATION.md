# 📝 Documentație Completă - Sistem Notare Evenimente (Petreceri)

## 📊 Overview

Sistemul de evenimente permite:

- ✅ Vizualizare evenimente (petreceri)
- ✅ Alocare staff pe evenimente
- ✅ Tracking "cine notează" (cine face bagajul)
- ✅ Filtrare după cod staff
- ✅ Calcul salarizare automată
- ✅ Real-time updates

---

## 🗄️ Structura Database

### Collection: `evenimente`

```javascript
{
  // Identificare
  id: "auto_generated_doc_id",
  nume: "Petrecere Revelion 2026",

  // Dată și locație
  data: "2026-12-31",           // Format: YYYY-MM-DD
  dataStart: "2026-12-31",      // Alias pentru data
  locatie: "Hotel Continental, București",

  // Staff
  rol: "ospatar",               // ospatar | barman | bucatar | manager
  nrStaffNecesar: 10,           // Câți oameni sunt necesari
  staffAlocat: [                // Array de UIDs Supabase Auth
    "uid_user_1",
    "uid_user_2",
    "uid_user_3"
  ],

  // Financiar
  durataOre: 8,                 // Durata evenimentului
  bugetStaff: 5000,             // RON - buget total pentru staff

  // Tracking
  cineNoteaza: "A1",            // Codul staff-ului care notează (face bagajul)

  // Metadata
  createdAt: Timestamp,
  createdBy: "uid_admin",
  updatedAt: Timestamp
}
```

---

### Collection: `staffProfiles`

```javascript
{
  uid: "supabase_auth_uid",     // ID Supabase Auth
  code: "A1",                   // Cod unic: A1-A50, Atrainer, etc.
  nume: "Ion Popescu",
  email: "ion@example.com",
  telefon: "+40712345678",
  rol: "ospatar",               // Rol principal
  activ: true,
  createdAt: Timestamp
}
```

**Format coduri valide:**

- **Trainer**: `Atrainer`, `Btrainer`, `Ctrainer`, etc.
- **Member**: `A1` - `A50`, `B1` - `B50`, etc.

**Regex validare:**

```javascript
const trainerPattern = /^[A-Z]TRAINER$/;
const memberPattern = /^[A-Z]([1-9]|[1-4][0-9]|50)$/;
```

---

### Collection: `disponibilitati`

```javascript
{
  userId: "supabase_auth_uid",
  userEmail: "ion@example.com",

  dataStart: "2026-12-20",
  dataEnd: "2026-12-31",
  oraStart: "08:00",
  oraEnd: "22:00",

  tipDisponibilitate: "disponibil",  // disponibil | indisponibil | preferinta
  notita: "Prefer evenimente în București",

  createdAt: Timestamp
}
```

---

## 🔐 Database Security Rules

```javascript
// Evenimente - doar admin poate crea/modifica
match /evenimente/{eventId} {
  allow read: if isAuthenticated();
  allow write: if isAdmin();
}

// Staff Profiles - toți pot citi, doar admin/owner pot modifica
match /staffProfiles/{profileId} {
  allow read: if isAuthenticated();
  allow write: if isAuthenticated() && (request.auth.uid == profileId || isAdmin());
}

// Disponibilități - user poate citi/scrie doar ale sale
match /disponibilitati/{dispId} {
  allow read: if isAuthenticated() && (resource.data.userId == request.auth.uid || isAdmin());
  allow write: if isAuthenticated() && request.resource.data.userId == request.auth.uid;
}
```

---

## 📱 Frontend - EvenimenteScreen.jsx

### 🔍 Filtre Disponibile

#### 1. Search (Text)

```javascript
const [search, setSearch] = useState('');

// Filtrare
if (search && !ev.nume?.toLowerCase().includes(search.toLowerCase())) {
  return false;
}
```

#### 2. Interval Dată

```javascript
const [dataStart, setDataStart] = useState('');
const [dataEnd, setDataEnd] = useState('');

// Filtrare
const dataEv = ev.data || ev.dataStart;
if (dataStart && dataEv < dataStart) return false;
if (dataEnd && dataEv > dataEnd) return false;
```

#### 3. Locație

```javascript
const [locatie, setLocatie] = useState('');

// Filtrare
if (locatie && !ev.locatie?.toLowerCase().includes(locatie.toLowerCase())) {
  return false;
}
```

#### 4. Rol

```javascript
const [rol, setRol] = useState('');

// Filtrare
if (rol && ev.rol !== rol) {
  return false;
}
```

#### 5. Ce Cod Ai (Vezi evenimente unde ești alocat)

```javascript
const [codCeCodAi, setCodCeCodAi] = useState('');
const [validareCeCodAi, setValidareCeCodAi] = useState('');

// Validare cod
const validateCeCodAi = async cod => {
  if (!isValidStaffCode(cod)) {
    setValidareCeCodAi('✗ Format invalid');
    return;
  }

  const staffSnapshot = await getDocs(
    query(collection(db, 'staffProfiles'), where('code', '==', cod.trim()))
  );

  if (!staffSnapshot.empty) {
    setValidareCeCodAi('✓ Cod acceptat');
  } else {
    setValidareCeCodAi('✗ Cod nu există în sistem');
  }
};

// Filtrare
if (codCeCodAi.trim() && validareCeCodAi === '✓ Cod acceptat') {
  const staffAlocat = ev.staffAlocat || [];
  const hasStaffWithCode = staffAlocat.some(uid => {
    const profile = staffProfiles[uid];
    return profile && profile.code === codCeCodAi.trim();
  });
  if (!hasStaffWithCode) return false;
}
```

#### 6. Cine Notează (Vezi evenimente unde tu notezi)

```javascript
const [codCineNoteaza, setCodCineNoteaza] = useState('');
const [validareCineNoteaza, setValidareCineNoteaza] = useState('');

// Validare similar cu "Ce cod ai"

// Filtrare
if (codCineNoteaza.trim() && validareCineNoteaza === '✓ Cod acceptat') {
  if (ev.cineNoteaza !== codCineNoteaza.trim()) {
    return false;
  }
}
```

---

### 📊 Status Evenimente

```javascript
const staffAlocat = ev.staffAlocat || [];
const nrStaffNecesar = ev.nrStaffNecesar || 0;

// Calcul status
const esteAlocat = staffAlocat.length > 0;
const esteComplet = staffAlocat.length >= nrStaffNecesar;

// Badge-uri
if (esteComplet) {
  // ✓ Complet (verde)
  <span className="badge badge-disponibil">✓ Complet</span>;
} else if (esteAlocat) {
  // ⚠ Parțial (galben)
  <span className="badge badge-warning">⚠ Parțial</span>;
} else {
  // ✗ Nealocat (roșu)
  <span className="badge badge-indisponibil">✗ Nealocat</span>;
}
```

---

### ⚡ Optimizări Performance

#### 1. Parallel Fetch

```javascript
// ÎNAINTE: 2 queries secvențiale (lent)
const evenimenteSnap = await getDocs(collection(db, 'evenimente'));
const staffSnap = await getDocs(collection(db, 'staffProfiles'));

// DUPĂ: Parallel fetch (2x mai rapid)
const [evenimenteSnap, staffSnap] = await Promise.all([
  getDocs(collection(db, 'evenimente')),
  getDocs(collection(db, 'staffProfiles')),
]);
```

#### 2. Pre-build Staff Map (O(1) lookup)

```javascript
// ÎNAINTE: N+1 queries (foarte lent)
for (const ev of evenimente) {
  for (const uid of ev.staffAlocat) {
    const staffDoc = await getDoc(doc(db, 'staffProfiles', uid)); // Query per staff!
  }
}

// DUPĂ: Pre-build map, O(1) lookup (100x mai rapid)
const staffProfiles = {};
staffSnap.docs.forEach(doc => {
  const data = doc.data();
  staffProfiles[data.uid] = data; // Map: uid -> profile
});

// Lookup instant
for (const ev of evenimente) {
  for (const uid of ev.staffAlocat) {
    const profile = staffProfiles[uid]; // O(1) lookup, no query!
  }
}
```

#### 3. Real-time Updates

```javascript
// onSnapshot pentru actualizări live (fără refresh manual)
const unsubscribe = onSnapshot(collection(db, 'evenimente'), snapshot => {
  const data = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  }));
  setEvenimente(data);
});

// Cleanup la unmount
return () => unsubscribe();
```

---

## 💰 Salarizare - SalarizareScreen.jsx

### Calcul Salariu

```javascript
// Pentru fiecare eveniment
const staffList = ev.staffAlocat || [];
const tarifPerPersoana = ev.bugetStaff ? ev.bugetStaff / staffList.length : 0;

// Acumulare per staff
for (const staffId of staffList) {
  if (!salarizariMap[staffId]) {
    salarizariMap[staffId] = {
      staffId,
      nume: staffData.nume || 'Necunoscut',
      email: staffData.email || '',
      evenimente: [],
      totalOre: 0,
      totalSuma: 0,
    };
  }

  salarizariMap[staffId].evenimente.push({
    numeEveniment: ev.nume,
    data: ev.data,
    ore: ev.durataOre || 0,
    suma: tarifPerPersoana,
  });

  salarizariMap[staffId].totalOre += ev.durataOre || 0;
  salarizariMap[staffId].totalSuma += tarifPerPersoana;
}
```

### Optimizare: Batch Fetch Staff Profiles

```javascript
// Colectează toate UID-urile unice
const uniqueStaffIds = new Set();
evenimenteFiltrate.forEach(ev => {
  (ev.staffAlocat || []).forEach(id => uniqueStaffIds.add(id));
});

// Batch fetch (max 10 per query - limită Database)
const staffProfiles = {};
const staffIds = Array.from(uniqueStaffIds);
const batchSize = 10;

for (let i = 0; i < staffIds.length; i += batchSize) {
  const batch = staffIds.slice(i, i + batchSize);
  const staffSnapshot = await getDocs(
    query(collection(db, 'staffProfiles'), where('uid', 'in', batch))
  );

  staffSnapshot.docs.forEach(doc => {
    staffProfiles[doc.data().uid] = doc.data();
  });
}

// Acum toate profile-urile sunt în memorie (O(1) lookup)
```

**Reducere queries:**

- Înainte: N queries (1 per staff)
- După: ceil(N/10) queries (batch de 10)
- **Economie: ~90% mai puține queries!**

---

## 📅 Disponibilitate - DisponibilitateScreen.jsx

### Adăugare Disponibilitate

```javascript
const handleAddDisponibilitate = async e => {
  e.preventDefault();

  await addDoc(collection(db, 'disponibilitati'), {
    userId: currentUser.uid,
    userEmail: currentUser.email,
    dataStart,
    dataEnd,
    oraStart,
    oraEnd,
    tipDisponibilitate, // disponibil | indisponibil | preferinta
    notita,
    createdAt: serverTimestamp(),
  });

  alert('Disponibilitate adăugată!');
  loadDisponibilitati();
};
```

### Ștergere Disponibilitate

```javascript
const handleDelete = async id => {
  if (!confirm('Ștergi această disponibilitate?')) return;

  await deleteDoc(doc(db, 'disponibilitati', id));
  alert('Disponibilitate ștearsă!');
  loadDisponibilitati();
};
```

---

## 🔄 Workflow Complet

### 1. Admin Creează Eveniment (Manual în Database)

```javascript
// Supabase Console → Database → evenimente → Add document
{
  nume: "Petrecere Revelion",
  data: "2026-12-31",
  locatie: "Hotel Continental",
  rol: "ospatar",
  nrStaffNecesar: 10,
  staffAlocat: [],
  bugetStaff: 5000,
  durataOre: 8,
  cineNoteaza: "",
  createdAt: serverTimestamp()
}
```

### 2. Staff Adaugă Disponibilitate

```
User → DisponibilitateScreen → Adaugă disponibilitate
→ Database: disponibilitati collection
```

### 3. Admin Alocă Staff pe Eveniment

```javascript
// Supabase Console → Database → evenimente → Edit document
{
  staffAlocat: ["uid1", "uid2", "uid3"],
  cineNoteaza: "A1"
}
```

### 4. Staff Verifică Evenimente Alocate

```
User → EvenimenteScreen → Filtru "Ce cod ai: A1"
→ Vezi toate evenimentele unde ești alocat
```

### 5. Staff Verifică Salariu

```
User → SalarizareScreen → Selectează perioadă
→ Vezi total ore + total suma pentru perioada selectată
```

---

## ❌ Funcționalități Lipsă (TODO)

### 1. Creare Evenimente din UI

**Lipsește:** Form de creare evenimente în frontend

**Soluție:**

```javascript
// Adaugă în EvenimenteScreen.jsx
const handleCreateEvent = async eventData => {
  await addDoc(collection(db, 'evenimente'), {
    ...eventData,
    staffAlocat: [],
    createdAt: serverTimestamp(),
    createdBy: currentUser.uid,
  });
};
```

### 2. Alocare Staff din UI

**Lipsește:** Interface pentru admin să aloce staff

**Soluție:**

```javascript
// Modal cu listă staff + checkbox
const handleAllocateStaff = async (eventId, selectedStaffIds) => {
  await updateDoc(doc(db, 'evenimente', eventId), {
    staffAlocat: selectedStaffIds,
    updatedAt: serverTimestamp(),
  });
};
```

### 3. Notificare Staff

**Lipsește:** Notificări când ești alocat pe eveniment

**Soluție:**

- Supabase Cloud Messaging (FCM)
- Email notifications
- WhatsApp notifications

### 4. Confirmare Participare

**Lipsește:** Staff să confirme/refuze participarea

**Soluție:**

```javascript
{
  staffAlocat: [
    { uid: 'uid1', status: 'confirmed' },
    { uid: 'uid2', status: 'pending' },
    { uid: 'uid3', status: 'declined' },
  ];
}
```

### 5. Check-in/Check-out

**Lipsește:** Tracking prezență la eveniment

**Soluție:**

```javascript
{
  attendance: [
    { uid: 'uid1', checkIn: Timestamp, checkOut: Timestamp },
    { uid: 'uid2', checkIn: Timestamp, checkOut: null },
  ];
}
```

### 6. Rating & Feedback

**Lipsește:** Evaluare staff după eveniment

**Soluție:**

```javascript
{
  ratings: [
    { uid: 'uid1', rating: 5, feedback: 'Excelent!' },
    { uid: 'uid2', rating: 4, feedback: 'Bun' },
  ];
}
```

---

## 🔐 Securitate

### Admin Check

```javascript
// Frontend - verificare pe rol din Database
const isAdmin = async (userId) => {
  const userDoc = await database.collection('users').doc(userId).get();
  return userDoc.data()?.role === 'admin';
};

// Database Rules - verificare pe custom claims
function isAdmin() {
  return isAuthenticated() && request.auth.token.role == 'admin';
}

// Sau verificare pe document user
function isAdmin() {
  return isAuthenticated() &&
    get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
}
```

### Validare Cod Staff

```javascript
// Format valid
const isValidStaffCode = cod => {
  const trimmed = cod.trim().toUpperCase();
  const trainerPattern = /^[A-Z]TRAINER$/;
  const memberPattern = /^[A-Z]([1-9]|[1-4][0-9]|50)$/;
  return trainerPattern.test(trimmed) || memberPattern.test(trimmed);
};

// Verifică existență în Database
const staffSnapshot = await getDocs(
  query(collection(db, 'staffProfiles'), where('code', '==', cod.trim()))
);

if (staffSnapshot.empty) {
  throw new Error('Cod nu există în sistem');
}
```

---

## 📊 Exemple Queries

### 1. Evenimente pentru un staff specific

```javascript
// Opțiunea A: Query direct (dacă staffAlocat e indexat)
const q = query(collection(db, 'evenimente'), where('staffAlocat', 'array-contains', userId));

// Opțiunea B: Fetch all + filter (folosit acum)
const allEvents = await getDocs(collection(db, 'evenimente'));
const myEvents = allEvents.docs.filter(doc => {
  const data = doc.data();
  return (data.staffAlocat || []).includes(userId);
});
```

### 2. Evenimente în perioadă

```javascript
const q = query(
  collection(db, 'evenimente'),
  where('data', '>=', dataStart),
  where('data', '<=', dataEnd),
  orderBy('data', 'asc')
);
```

### 3. Staff disponibil în perioadă

```javascript
const q = query(
  collection(db, 'disponibilitati'),
  where('dataStart', '<=', dataEveniment),
  where('dataEnd', '>=', dataEveniment),
  where('tipDisponibilitate', '==', 'disponibil')
);
```

---

## 🎯 Best Practices

### 1. Batch Operations

```javascript
// Batch write pentru multiple updates
const batch = writeBatch(db);

staffIds.forEach(staffId => {
  const ref = doc(db, 'staffProfiles', staffId);
  batch.update(ref, { lastEventDate: eventDate });
});

await batch.commit();
```

### 2. Transactions pentru Consistență

```javascript
// Asigură că bugetul e corect distribuit
await runTransaction(db, async transaction => {
  const eventRef = doc(db, 'evenimente', eventId);
  const eventDoc = await transaction.get(eventRef);

  const staffCount = eventDoc.data().staffAlocat.length;
  const tarifPerPersoana = eventDoc.data().bugetStaff / staffCount;

  // Update event cu tarif calculat
  transaction.update(eventRef, { tarifPerPersoana });
});
```

### 3. Indexing pentru Performance

```javascript
// database.indexes.json
{
  "indexes": [
    {
      "collectionGroup": "evenimente",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "data", "order": "ASCENDING" },
        { "fieldPath": "locatie", "order": "ASCENDING" }
      ]
    }
  ]
}
```

---

## 📈 Metrici & Monitoring

### Queries per Page Load

**Înainte optimizări:**

- Evenimente: 1 query
- Staff profiles: N queries (1 per staff)
- **Total: 1 + N queries**

**După optimizări:**

- Evenimente: 1 query
- Staff profiles: ceil(N/10) batch queries
- **Total: 1 + ceil(N/10) queries**

**Exemplu:** 50 staff

- Înainte: 51 queries
- După: 6 queries
- **Economie: 88%!**

---

## 🚀 Deployment

### 1. Deploy Database Rules

```bash
supabase deploy --only database:rules
```

### 2. Deploy Database Indexes

```bash
supabase deploy --only database:indexes
```

### 3. Deploy Frontend

```bash
cd kyc-app/kyc-app
npm run build
supabase deploy --only hosting
```

---

## 📝 Summary

**Ce Funcționează:**

- ✅ Vizualizare evenimente
- ✅ Filtrare avansată (6 filtre)
- ✅ Validare cod staff
- ✅ Calcul salarizare automată
- ✅ Real-time updates
- ✅ Optimizări performance (90% mai puține queries)

**Ce Lipsește:**

- ❌ Creare evenimente din UI
- ❌ Alocare staff din UI
- ❌ Notificări
- ❌ Confirmare participare
- ❌ Check-in/Check-out
- ❌ Rating & Feedback

**Next Steps:**

1. Adaugă form de creare evenimente
2. Implementează alocare staff din UI
3. Adaugă notificări FCM
4. Implementează confirmare participare

---

**Status**: ✅ Sistem funcțional, optimizat, gata de producție
**Performance**: 90% reducere queries, real-time updates
**Security**: Database rules configurate, validare cod staff
