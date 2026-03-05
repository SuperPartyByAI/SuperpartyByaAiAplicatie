# Superparty PBX End-to-End Audit (Hetzner + Twilio + Supabase)

_Acest document reflectă arhitectura curentă exactă de pe nodul `91.98.16.90` și clientul Flutter (branch: `xiaomi-call-loop-fix-v3`)._

## 1. Flow Map (Diagrama Logică)

### A) Inbound PSTN -> PBX -> Agent Flutter -> Audio Connected

1. **[PSTN] Caller** apelează numărul public Twilio (`+40373805828`).
2. **[Twilio]** declanșează Webhook `POST http://91.98.16.90:3001/api/voice/incoming`.
3. **[Hetzner PBX]** creează imediat o cameră de așteptare `<Conference>conf_CallSid</Conference>` și plasează Caller-ul acolo pe muzică de așteptare.
4. **[Hetzner PBX]** extrage **cel mai recent** agent activ (un singur `device_identity`) din RAM sau din Supabase (`device_tokens`).
5. **[Wake Signal]** PBX trimite instant o notificare de alertă custom:
   - Prin **WebSocket** deschis (`/voip-ws`).
   - Prin **FCM V1** (`google-auth-library` folosind `gpt-firebase-key.json`).
6. **[Android Native]** `CustomVoiceFirebaseMessagingService` (Prioritate Maximă) prinde semnalul FCM și forțează Android-ul să deschidă un Ecran de Apel nativ scris în Kotlin (`IncomingCallActivity.kt`) direct peste Lock Screen.
7. **[Agent Action]** Agentul apasă _"Answer"_.
8. **[Native Proxy]** `IncomingCallActivity.kt` trimite HTTP POST către `http://91.98.16.90:3001/api/voice/accept`.
9. **[PBX Bridge]** Serverul Node prinde `/accept` și face cerere la Twilio API: `twilioClient.calls.create({ to: 'client:AgentID', url: '/api/voice/join-conference' })`.
10. **[Twilio]** sună instanța de WebRTC din interiorul Flutter-ului (prin _Twilio Native Push_), iar aplicația răspunde automat legând microfonul agentului în Conferința de așteptare. Vocile sunt unite bidirecțional.

### B) Outbound din Flutter -> PSTN

1. Agentul deschide Dialer-ul în aplicație și apasă Call.
2. Flutter dă comandă SDK-ului: `TwilioVoice.instance.call.place(to: Număr)`.
3. **[Twilio]** primește comanda de plecare din SDK (cu TWI_ML_APP_SID) și apelează **același webhook**: `POST /api/voice/incoming` (ca Outbound).
4. **[Hetzner PBX]** _[Atenție - Risc!]._ Serverul primește ruta, returnează `<Dial><Number>Număr</Number></Dial>` și apelul este conectat PSTN.

### C) Reject / Hangup

1. Agentul apasă _"Reject"_ pe ecranul `IncomingCallActivity.kt` (sau în Flutter).
2. Android/Flutter trimite un HTTP POST către `http://91.98.16.90:3001/api/voice/hangup`.
3. **[Hetzner PBX]** actualizează statusul Conferinței Twilio la `completed`, forțând închiderea apelului PSTN.
4. **[WebSocket Sync]** Serverul dă broadcast `call_closed` via WS, pentru ca toate celelalte ecrane Flutter (dacă mai există) să se închidă fizic.

---

## 2. Checklist Configurări (Infrastructură)

- [x] **Twilio Console Webhook**: Setează Voice URL pe TwiML App la `http://91.98.16.90:3001/api/voice/incoming`.
- [ ] **Twilio Security**: (P0) Curent, portul `3001` este DESCHIS tuturor cererilor HTTP fară verificare de semnătură Twilio (`X-Twilio-Signature`). Un atacator poate simula apeluri trimițând POST-uri fake direct pe IP.
- [ ] **Hetzner Firewall**: Portul 3001 este expus raw pe IP. Trebuie restricționat exclusiv pentru `localhost` și accesat de la client doar prin `Nginx` + TLS (HTTPS).
- [ ] **Docker Reverse Proxy**: Momentan Node.js servește HTTP pur din container. **Trebuie montat bloc Nginx cu SSL**.

---

## 3. Dependențele Firebase vs. Supabase

**De ce mai există Firebase în proiect la acest moment?**

- Firebase **DB / Auth**: S-a renunțat complet. Totul este centralizat pe `Supabase` prin `user_id` și tokenuri JWT mapate local.
- **Firebase Cloud Messaging (FCM)**: Este **OBLIGATORIU** și **PĂSTRAT**.
  - _Motiv_: Infrastructura Twilio Push nu poate trece prin filtrele de economisire energie ale producătorilor chinezi (Huawei, Xiaomi). FCM V1 Payload-ul nostru _personalizat_ (`"wake_up"`) trezește direct Sistemul de Operare la rang de Alarmă (Priority 1) folosind `CustomVoiceFirebaseMessagingService`.
  - Niciun alt protocol (cum ar fi WebSockets simplu) nu garantează trezirea telefonului din stare Doze (Deep Sleep).

---

## 4. Gap-uri de Funcționalitate (Nepreluate / Bugs)

| Categorie                        | Problemă/Gap                               | Explicație & Fix Recomandat                                                                                                                                                                                                                                                                                                                              |
| :------------------------------- | :----------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Flutter VoIP Endpointing**     | Blocaj HTTP Cleartext                      | **Rezolvat Live**. În `.kt` nativ era rămas IP-ul VECHI de la V3 (`89.167.115.150`). Relația nativă accept/hangup nu mai lovea PBX-ul curent. Necesită compilare USB obligatorie pentru a propaga noul IP `91.98.16.90`.                                                                                                                                 |
| **Securitate Endpoint-uri Node** | Lipsă `X-Twilio-Signature`                 | Oricine trimite POST fake cu JSON la `/api/voice/accept` sau `/api/voice/incoming` îți poate declanșa Call-uri Twilio pe banii tăi. (Fix P0 în Node.js)                                                                                                                                                                                                  |
| **Outbound SDK Routing**         | Eroare conceptuală in `/incoming`          | Endpoint-ul din Node `app.post('/api/voice/incoming')` nu face încă o distincție exactă între `Direction = inbound` (PSTN) și cel plecat din SDK-ul Flutter spre lume. Dacă agentul dă Call Clientului, va primi propria sa Conferință. E necesar un bloc simplu de `if (req.body.Direction === 'inbound') { PBX_conferinta } else { Dial_numar_pstn }`. |
| **Supabase Sync**                | Tabela `calls` nu este actualizată de Node | Când PBX-ul preia webhook-uri, NU salvează deloc în Supabase tabela `calls`. Flutter-ul în V3 se baza pe asta să arate Istoricul Apelurilor (Recent Calls).                                                                                                                                                                                              |

---

## 5. Partea 1 - Verificare Backend (voice-service)

A) **Endpoints Core Curente**: Toate proxy-urile manuale au fost restabilite direct în PBX:

- `/api/voice/accept`, `/api/voice/hangup`, `/api/voice/join-conference`
- Aceste endpoint-uri _suplinesc_ erorile native de la framework-ul Twilio-Flutter.

B) **Twilio Token Correctness**:

- `pushCredentialSid` injectat in VoiP Token este exact valoarea din `process.env.TWILIO_PUSH_CREDENTIAL_SID`. Lipsa acestei chei face ca WebRTC-ul de iOS sau telefoanele Android standard să primească apelul _dar să nu poată comunica cu Twilio în stadiul "Ringing"_, generând eșec instant de bridge.

C) **Prevenirea Buclării Apelurilor Suprapuse**:

- S-a eliminat din vechiul V3 iterarea la grămadă: acum se extrage UN SINGUR token (`limit(1)`) sortat descrescător după `last_seen_at`.
- Node.js dă `dial.conference()` strict pentru acest `targetClient.id`. Nu se vor mai genera "Ghost Calls" sau telefoane care sună noaptea la foști agenți dezautentificați.

D) **WebSocket handshake**:

- Cererea `ws://.../voip-ws?token=` este validată folosind `process.env.JWT_SECRET`.
- _Risc_: Curent se folosește un `JWT_SECRET` local Node.js nesincronizat transparent cu cel de la Supabase.

---

## 6. Partea 2 - Verificare Supabase (Schema SQL Mismatch)

Codul Node.js pentru înregistrarea aparatelor conține clauza:
`.upsert({ ... }, { onConflict: 'user_id,device_id' })`

Dacă această cheie Compusă Unică nu există activ în baza Supabase, PostgREST dă EROARE FATALĂ la fiecare login și tokenurile tale Firebase nu mai ajung pe PBX niciodată.

**Rulează URGENT acest SQL în Supabase SQL Editor:**

```sql
-- Dă drop la resturile din vechile migrații
ALTER TABLE public.device_tokens DROP CONSTRAINT IF EXISTS device_tokens_device_identity_key;
ALTER TABLE public.device_tokens DROP CONSTRAINT IF EXISTS unique_user_device;

-- Creează logica unică exact ca în cod
ALTER TABLE public.device_tokens ADD CONSTRAINT unique_user_device UNIQUE (user_id, device_id);
ALTER TABLE public.device_tokens ADD CONSTRAINT device_tokens_device_identity_key UNIQUE (device_identity);
```

---

## 7. Plan de PR: Top 5 Schimbări Prioritare (P0 / P1)

1. **[P0][Flutter/Nativ]** `android/app/src/.../network_security_config.xml` & `IncomingCallActivity.kt` -> Schimbarea vechilor IP-uri cu Hetzner IP. (A fost patch-uit de mine ACUM. Aplică build din USB și fă push în git la ele pe branch).
2. **[P0][Securitate/Node]** Securizarea rutelor expuse cu validare de Payload SMS/Voce de la Twilio (middleware `twilio.webhook()`).
3. **[P1][Logică Apel]** Implementarea distingerii în `/incoming` route în PBX: Dacă req.body.Direction e outbound SDK sa scoata `twiml.dial().number(...)` in loc sa ingroape apelul in Conferinta locala.
4. **[P1][Bază de Date]** Rularea fisierelor de migrare Supabase ca logica `upsert` să nu mai lovească `500 Internal Error`.
5. **[P2][Config Nginx]** Inchiderea portului 3001 pe `0.0.0.0` si maparea traficului Node strict din spatele Ngnix Certbot HTTPS pentru a evita SocketExceptions de pe device-urile iOS de productie.

---

## 8. Test Plan de Acceptanță

1. **Test DB Refresh:** Dă "Log Out" din aplicație. Apoi "Log in". Verifică in portalul Supabase la tabela `device_tokens` ca rândul tău s-a actualizat (timestamp curent) și nu a apărut o eroare PostgreSQL pe inserare.
2. **Ping Server Token:** Copiaza URL-ul `http://91.98.16.90:3001/api/voice/getVoipToken?userId=[TĂU]&deviceId=[TELEFON]` în consolă și dă decode JWT-ului pe jwt.io. Verifică secțiunea de `grants`. Trebuie să aibe vizibil `push_credential_sid` cu seria reală de Twilio (CR...).
3. **Hardware Test (Inbound Bridge):** Sună la la +40373805828. Android-ul trebuie sa faca ecran lock. Cand apesi "Answer", Twilio Logger-ul din server iti va arata _[/api/voice/accept] incoming body... creando Twilio call_. Sunetul trebuie propagat în 2 secunde.
4. **Outbound Trap:** Incearca sa suni din aplicatie spre un telefon normal PSTN. Asigura-te ca backend-ul il emite catre lume.
5. **Cancel Hook:** Fă un apel test dar ignoră soneria de pe Huawei. Din telefonul apelant, dă click "Inchide/End Call". Ecranul aplicației blocat din fața teleonului Huawei Trevor va dispărea la 2 secunde in mod automat (propagare Websocket Hangup).

### Environment Vars Necesare pe Hetzner (`.env` pe VM)

```env
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
BASE_URL=http://91.98.16.90:3001  # Momentan IP public!

TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_API_KEY_SID=SK...
TWILIO_API_KEY_SECRET=...
TWILIO_TWIML_APP_SID=AP...
TWILIO_PUSH_CREDENTIAL_SID=CR...
TWILIO_CALLER_ID=+40373805828

JWT_SECRET=superparty_secret_wa_v3_xyz_...
GOOGLE_APPLICATION_CREDENTIALS=/app/gpt-firebase-key.json
```
