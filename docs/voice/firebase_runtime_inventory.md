# Firebase Runtime Inventory & PBX Call Flow

## Flow Diagrama curentă (Cu `Huawei Mode` curat integrat):

1. **Incoming PSTN** -> Apel către `+40373805828`.
2. **Twilio Webhook** -> Către `https://voice.superparty.ro/api/voice/incoming`.
3. **Backend Wake-Up (FCM v1)** -> Serverul Node citește cheia `gpt-firebase-...` și trimite `type: 'incoming_call'` cu destinație fixă spre `fcmToken`.
4. **Twilio FCM** -> Trimis simultan de SDK-ul Twilio (Twilio Push Credential).
5. **CustomVoiceFirebaseMessagingService** -> Prinde Wake-Up-ul Backend pe Huawei. (Unicul receiver prioritar Android).
6. **ACK (Native)** -> Kotlin face GET la `/api/voice/push-ack-native`. Backend recunoaște telefonul curent.
7. **IncomingCallActivity (Native Mute/Ringing)** -> Pe Huawei se ignoră Twilio Flutter Invoke, UI nativ e stăpân.
8. **ACCEPT-NATIVE** -> Userul glisează Răspunde pe ecranul Huawei. Request sincron către API Node.
9. **Winner Atomic Lock** -> Supabase dă Lock tranzacțional primului ACCEPT. Canceling others.
10. **Connected (Twilio Bridge)** -> Twilio leagă Userul la conferența TwiML. Hold music stins.
11. **Flutter UI Sync** -> Flutter prinde Evenimentul `CallEvent.connected` prin Socket WebSocket/Twilio și afișează cronometrul.

## Harta de Roluri Supreme

### Ce Rol MAI ARE Firebase:

- **FCM Transport:** Conducta de mesaje silențioase Push de la Twilio & Propriul Backend spre Android/iOS. Atât. Fără el nu poți trezi telefonul din Deep Sleep și nici nu poți eluda Doze Mode pe Android 14.

### Ce Rol NU MAI TREBUIE SĂ AIBĂ Firebase:

- **Autentificare Utilizatori:** Metoda `verifyIdToken` sau `Firebase Admin Auth`.
- **Baza de date apeluri/logistici:** Firestore / Realtime DB. Funcțiile `db.collection()` sunt anti-pattern pe arhitectura Superparty V6. Colecțiile `voice_calls` trăiesc exclusiv în Supabase (sursă de adevăr).
- **Storage Fișiere Audio:** Toate atașamentele se duc în AWS sau Supabase Storage.
