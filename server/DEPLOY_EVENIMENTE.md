# Deploy Evenimente - Instrucțiuni

## 1. Deploy Indexuri Database

```bash
supabase deploy --only database:indexes
```

Sau manual în Supabase Console:

1. Deschide [Supabase Console](https://console.supabase.google.com)
2. Selectează proiectul
3. Database Database → Indexes
4. Adaugă indexurile din `database.indexes.json`

## 2. Seed Date Evenimente

```bash
cd /workspaces/Aplicatie-SuperpartyByAi
node scripts/seed_evenimente.js
```

Acest script va adăuga 7 evenimente demo în Database.

## 3. Verificare

După deploy, verifică în Supabase Console:

- Database → `evenimente` collection → ar trebui să vezi 7 documente
- Indexes → ar trebui să vezi indexurile pentru `data` (ASC/DESC)

## 4. Test în Aplicație

1. Deschide aplicația Flutter
2. Navighează la "Evenimente"
3. Testează:
   - ✅ Lista se încarcă din Database (nu demo data)
   - ✅ Filtrele funcționează
   - ✅ Sortarea funcționează
   - ✅ "Evenimentele mele" e disabled dacă nu ești logat

## Probleme Comune

### Eroare: "Missing index"

- Rulează `supabase deploy --only database:indexes`
- Sau creează indexul manual din link-ul din eroare

### Evenimente nu apar

- Verifică că seed script-ul a rulat cu succes
- Verifică în Supabase Console că există documente în `evenimente`

### "Evenimentele mele" nu funcționează

- Asigură-te că ești autentificat în aplicație
- Verifică că evenimentele au `alocari` cu `userId` setat
