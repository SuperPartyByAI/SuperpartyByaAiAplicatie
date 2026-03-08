# Firebase Cleanup Actions

Pentru a finaliza epurarea modulelor Firebase din ecosistem care sfidează noua arhitectură bazată pe Supabase V6, recomandăm curățenia următoarelor vestigii arhitecturale:

## Lista de Acțiuni Imediate

1. **Ștergerea Scripturilor Vechi:**
   - `/server/scripts/set_admin_claims.mjs`
   - `/server/scripts/revoke_admin.mjs`
   - Toate fișierele cu unghi predominant `admin.auth()` fără alternativă Supabase.

2. **Revizuirea Serviciului WhatsApp (Dacă aparține de Superparty Repo):**
   - Trebuie investigat `/server/whatsapp-integration-v6` pentru apeluri `admin.auth().verifyIdToken()`.
   - Portarea lor pe standardul `supabase.auth.getUser()`. Metoda de extindere logică a permiselor trebuie centralizată via PostgreSQL RLS.

3. **Verificarea Variabilelor de Mediu VPS:**
   - Din Hetzner, scoase din `.env` cheile globale legate de Firebase **cu excepția** unicului fișier de cont de serviciu (ex: `gpt-firebase-key.json`) utilizat strict de funcția Node.js dedicată pentru `fcm.googleapis.com`.

4. **Curățare Dependințe `package.json`:**
   - În frontend-ul de React/Next (dacă există adiacent) și backend-ul general, bibliotecile precum `firebase-admin` trebuiesc retrogradate în favoarea pachetului restrictiv de Google Auth GCP Cloud Messaging dacă se doresc zero erori confuzive pe viitor. Urmărit strict pachetele NPM.

## Verdict PBX Firebase Cleanup

**FIREBASE STRUCTURE CLEAN** exclusiv pe ramura `voice-service` (Care folosește FCM exact și doar curat pentru notificări). Pe celelalte ramuri (WhatsApp / Admin scripts locale), structura **NOT CLEAN** (necesită delete pentru a nu provoca false pozitive colegilor dezvoltatori pe viitor).
