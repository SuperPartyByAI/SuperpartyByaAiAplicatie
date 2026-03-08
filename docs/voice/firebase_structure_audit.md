# Firebase Structure Audit: Voice & PBX

Acest document reflectă o analiză a capilarelor prin care Firebase mai traversează arhitectura sistemului Superparty Voice/PBX.

## A. Android / Firebase Client Side

### 1. AndroidManifest.xml

- **Status:** CLEAN.
- **Componente Identificate:** `<service android:name=".services.CustomVoiceFirebaseMessagingService">` cu `intent-filter` pe `com.google.firebase.MESSAGING_EVENT` (prioritate 1).
- **Prioritate & Flow:** Aceasta este singura poartă de intrare a notificărilor push in background. Serviciul oficial Twilio (`VoiceFirebaseMessagingService`) a fost eliminat conștient din manifest, lăsând `CustomVoiceFirebaseMessagingService` ca _unicul point of contact_ (evitând multiple instanțieri native de acceptare pe Huawei). Bifat ca **CORE/NECESAR**.

### 2. Kotlin / Android Native

- **CustomVoiceFirebaseMessagingService.kt**
  - **Rol:** Prinde mesajul de wake-up de tip `incoming_call` de la backend și declanșează fluxul nativ sau trezește Flutter via Twilio SDK Invoke. Pe telefoanele Huawei activează _HUAWEI MODE_ - care by-pass-ează logica Flutter UI.
  - **Network:** Interpelează endpoint-urile NodeJS POST `/api/voice/push-ack-native`.
  - **Status:** KEEP - Extrem de vital pentru coliziunile cu telefoanele asiatice și trezirea aplicației din doze.
- **IncomingCallActivity.kt**
  - **Rol:** Afișează ecranul nativ Full-Screen pe Lockscreen. Reacționează la preluarea prin trimiterea semnalului unic către `/api/voice/accept-native`.
  - **Network:** POST `https://voice.superparty.ro/api/voice/accept-native`
  - **Status:** KEEP - Lipsit de Firebase, dar acționat de payloadul primit de FCM.

### 3. Flutter Side

- **main.dart & voip_service.dart**
  - **Firebase Core & Messaging:** Sunt esențiale. `Firebase.initializeApp()` pornește motorul care va obține ulterior Token-ul general de FCM. Tot în dart se regăsesc ascultătorii de `FirebaseMessaging.onBackgroundMessage(_fcmBackgroundHandler)`. Mai mult, funcția `getDeviceToken` depinde direct de Firebase pentru a obține un token FCM standard (`fcmToken`) care se leagă apoi în backend de `deviceId`.
  - **Status:** KEEP - Necesare strict pentru Transport FCM, nu pentru Auth sau Data. Nicio urmă de `firebase_auth` prezentă în codul `lib/*`.

## B. Backend / Firebase Server Side

### 4. Server Voice (`voice-service/index.js`)

- **Referințe Găsite:** Folosirea `google-auth-library` generează access token-uri v1 ce trimit request HTTP la `https://fcm.googleapis.com/v1/projects/{projectId}/messages:send`.
- **Rol:** Singurul scop decelat al acestor biblioteci GCP este să livreze notificările de fundal de tip "wake-up" (`type: 'incoming_call'`) pe care Twilio pur și simplu nu le poate garanta nativ ca fiind cu prioritate maximă global (FCM VoIP policy).
- **Verdict:** KEEP - Metodă validă și esențială pe care V6 se prinde cu lockul atomic.

### 5. Runtime-uri vechi / Legacy

- **Referințe Detectate:**
  - `server/scripts/set_admin_claims.mjs`: `const auth = admin.auth();`
  - `server/scripts/revoke_admin.mjs`: `const auth = admin.auth();`
  - Diverse fragmente din Whatsapp/Admin scripts cu `.verifyIdToken(token)` vizibili în `server/whatsapp-integration-v6`.
- **Clasificare:** DEAD CODE / RISKY IF LIVE. Aceste script-uri nu folosesc Supabase și au rămas în stivă ca instrumente Node de întreținere din V5. Este imperativ ca un "fire-drill" viitor să le șteargă. Nu impactează live Voice, sunt scripturi offline de administrare.
