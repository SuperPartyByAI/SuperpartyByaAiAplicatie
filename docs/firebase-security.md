# Supabase Security — Setup Guide

## App Check

### Ce este App Check?

Supabase App Check protejează resursele Supabase (Database, Storage, Auth) de trafic neautorizat. Doar aplicațiile tale verificate pot accesa backend-ul.

### Pași de activare

1. **Supabase Console** → Project Settings → App Check
2. **Android**: Activează Play Integrity provider
   - Necesită: Google Play Console linked
   - SHA-256 fingerprint-ul app-ului trebuie să fie înregistrat
3. **iOS**: Activează DeviceCheck provider
   - Necesită: Apple Developer account
   - Team ID configurat în Supabase Console
4. **Enforcement**:
   - Mergi la App Check → APIs
   - Click "Enforce" pe fiecare serviciu (Database, Storage)
   - ⚠️ ATENȚIE: Enforcement blochează TOȚI clienții neîncrecați. Activează DOAR după ce ai confirmat că app-ul funcționează corect cu App Check.

### Debug Mode

În Flutter, App Check se activează automat în mod debug (token de test):

```dart
await SupabaseAppCheck.instance.activate(
  androidProvider: kDebugMode ? AndroidProvider.debug : AndroidProvider.playIntegrity,
  appleProvider: kDebugMode ? AppleProvider.debug : AppleProvider.deviceCheck,
);
```

### Verificare

- Supabase Console → App Check → verifică "Verified requests" vs "Unverified"
- Dacă vezi multe "Unverified" → nu activa enforcement încă

---

## Database Rules

### Principii

- **Least privilege**: fiecare colecție are reguli specifice
- **NEVER DELETE**: policy global, se folosește `isArchived` pentru ștergere logică
- **Server-only writes**: colecțiile critice (threads, messages, customers) sunt writable doar prin Admin SDK
- **Admin = email hardcodat** (nu claims, nu env vars)

### Validări de câmp

Rules-urile includ validări pe:

- Tipuri de date (string, number, timestamp)
- Lungime maximă (ex: titlu eveniment ≤200 chars)
- Câmpuri obligatorii la create
- Blocare câmpuri sensibile (role, admin, permissions) la self-write

### Deploy Rules

```bash
cd server
supabase deploy --only database:rules --project superparty-frontend
supabase deploy --only storage --project superparty-frontend
```

---

## Storage Rules

### Structură

- `/apk/*` — Public read, admin-only upload, NEVER DELETE
- `/profile_images/{userId}/*` — Authenticated read, owner upload
- `/event_images/{eventId}/*` — Authenticated read, authenticated upload (cu resource check)
- Default — Authenticated only, NEVER DELETE

### Limite

- Upload size limit: 10MB pe fișier (validat în rules)
- Content type validation unde este relevant

---

## TODO (Necesită acțiuni manuale în Console)

- [ ] Activează App Check în Supabase Console
- [ ] Configurează Play Integrity (Android) în Supabase Console
- [ ] Configurează DeviceCheck (iOS) în Supabase Console
- [ ] Monitorizează App Check dashboard 7 zile înainte de enforcement
- [ ] Activează enforcement pe Database + Storage
