# Debug Report: 503 No Active WhatsApp Session

## Context

Am re-inițializat folderul `auth_info` de pe server pentru curățenie. Dintre conturi, specific `XANaSkgQzW5Z1VfmIvCs` (HappyParty) rămâne aparent blocat sau dă 503. Pe interfața web "Admin Dashboard" din aplicația curentă Flutter, utilizatorul deschide `AccountsScreen` și apasă Regenerate QR. Când se apasă, un QR este generat și expediat înapoi, dar după o încercare de trimitere a mesajului, răspunsul este mereu 503 "No active WhatsApp session found".

## Reproducerea (Pasi)

1. **Regenerate QR**: Apăsare pe buton în Flutter, trimite POST implicit către `/api/accounts/XANaSkgQzW5Z1VfmIvCs/regenerate-qr`.
2. **Scanare**: Utilizatorul încearcă să folosească acel QR. Serverul PM2 primește interogarea dar din motive diverse ori window-ul expiră repede, ori `session-manager.js` pica vreo variabilă pe parcursul pairing-ului ce impiedică schimbarea stării la real `connected`.
3. **Trimitere**: Cand apasa send din flutter, `/messages/XANaSkgQzW5Z1VfmIvCs...` returnează nativ _503_ de la middleware-ul de verificare.

## De Verificat Pentru Expertiză (Catre AI Assistant)

Verifică cu strictețe linia JID-ului în funcțiile `processBaileysMessage`, verifică structura de mapping din `startSession` (când emite QR-ul și re-validează la creds.update) și modul în care payload-ul e pasat din aplicație.`syncOptions` ReferenceError a fost gestionat sumar, dar reverifică flow-ul.

_Notă_: Toate token-urile de sistem regasite in requesturile de curl si in fisiere au fost cu grija inlocuite cu REDACTED.
