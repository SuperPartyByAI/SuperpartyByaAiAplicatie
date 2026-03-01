# Migrare Canonical JID

## Context

Conversațiile WhatsApp pot avea multiple identificatori (JID, LID, clientId) care punctează la aceeași persoană. Asta creează duplicate în colecția `threads`.

## Script: `scripts/migrate-canonical-jid.js`

### Ce face

1. Încarcă toate documentele din `threads`
2. Grupează pe phone number (normalizat = doar cifre)
3. Detectează duplicate (>1 doc per phone)
4. Păstrează documentul cu `lastMessageAt` cel mai recent
5. Mută mesajele subcollection de la loser → winner
6. Marchează loser-ul cu `isArchived: true` (NEVER DELETE policy)
7. Setează `canonicalJid` pe winner

### Rulare

```bash
# DRY RUN (preview, fără modificări)
cd server
DRY_RUN=true node scripts/migrate-canonical-jid.js

# LIVE (cu modificări)
DRY_RUN=false node scripts/migrate-canonical-jid.js
```

### Backup

Scriptul salvează automat un backup JSON în `server/backups/` înainte de orice modificare.

### Verificare post-migrare

```bash
# Verifică dacă mai sunt duplicate
node -e "
const admin = require('supabase-admin');
admin.initializeApp();
const db = admin.database();
db.collection('threads').get().then(snap => {
  const phones = {};
  snap.docs.forEach(d => {
    const p = (d.data().clientId || d.id).split('@')[0].replace(/\D/g,'');
    if (p.length >= 7) {
      phones[p] = (phones[p] || 0) + 1;
    }
  });
  const dups = Object.entries(phones).filter(([,v]) => v > 1);
  console.log('Duplicate phones remaining:', dups.length);
  dups.forEach(([p,c]) => console.log('  ', p, ':', c, 'docs'));
});
"
```

### Rollback (dacă e necesar)

```bash
# Restaurează din backup
node -e "
const fs = require('fs');
const admin = require('supabase-admin');
admin.initializeApp();
const db = admin.database();
const backup = JSON.parse(fs.readFileSync('server/backups/canonical-migration-backup-TIMESTAMP.json'));
// Restaurarea manuală implică:
// 1. Dearchivarea loser-ilor
// 2. Ștergerea câmpurilor canonicalJid și mergedFrom de pe winneri
// Consultă echipa înainte de a rula rollback.
"
```
