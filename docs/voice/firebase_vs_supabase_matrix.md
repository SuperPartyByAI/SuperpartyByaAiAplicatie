# Firebase vs Supabase: PBX Matrix

| Fișier / Componentă              | Rol                              | Host Asignat            | Atinge Firebase?       | Atinge Supabase?     | Verdict            |
| :------------------------------- | :------------------------------- | :---------------------- | :--------------------- | :------------------- | :----------------- |
| `AndroidManifest.xml`            | Declară serviciile sistemului    | Local (Device)          | DA (FCM)               | NU                   | **KEEP**           |
| `CustomVoiceFirebase...kt`       | Interceptează wake-up FCM        | Local (Device)          | DA (FCM Payload)       | NU                   | **KEEP**           |
| `IncomingCallActivity.kt`        | Afișează Native UI pentru apel   | Local (Device)          | NU (doar Intent local) | NU                   | **KEEP**           |
| `lib/main.dart`                  | Initializează Flutter App & Push | Local (Device)          | DA (FCM / Core)        | DA (Supabase Auth)   | **KEEP**           |
| `lib/services/voip_service.dart` | Gestionează UI Bridge + Twilio   | `voice.superparty.ro`   | DA (token FCM)         | DA (Backend Fetch)   | **KEEP**           |
| `server/voice-service/index.js`  | PBX Node.js Server Runtime       | `91.98.16.90` (Hetzner) | DA (FCM v1 Send)       | DA (DB & Auth Check) | **KEEP**           |
| `server/scripts/set_admin...mjs` | Utilitar pentru ROL Admin        | Local / CI              | DA (Firebase Auth)     | NU                   | **DELETE**         |
| `server/whatsapp-integration...` | Backend învechit WA Session      | `(Hetzner Vechi)`       | DA (Firestore/Auth)    | NU (în unele părți)  | **MIGRATE/DELETE** |

## Riscuri dacă rețeaua Legacy rămâne

- Confuzie în rândul noilor module Backend (Supabase vs Firebase Auth).
- Erori runtime `db.collection is not a function` pe servicii hibride din cauza importului mixat `admin.auth()`.
- Atacuri de tip "Token Reuse" dacă ambele sisteme emit JWT-uri iar cheile vechi nu au fost revocate.
