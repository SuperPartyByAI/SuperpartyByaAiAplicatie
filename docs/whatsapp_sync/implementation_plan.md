# Detalii Implementare Heartbeat WhatsApp & Supabase Online Real-Time

Scopul principal este să bypassăm state-ul eronat de `connected` (Stale / Zombie sockets) definind o metodă bazată strict pe PING/Heartbeat ce se propagă asincron către Supabase.

## User Review Required

> [!IMPORTANT]
>
> - Mecanismul de Heartbeat trebuie pornit global dintr-un Cron/Interval în back-end, rulând la 30 de secunde pe rândurile active.
> - Schema de date implică crearea unui **Supabase VIEW** peste tabela `wa_accounts` (`wa_accounts_live`) pe care Flutter îl va putea citi ca să afișeze un status real de tip _Online / Stale / Disconnected_.

Vei putea să verifici corectitudinea mecanismului pur și simplu privind în interfața grafică, unde numărătoarea timestamp-urilor ar trebui să curgă la fiecare jumătate de minut.

---

## Proposed Changes

### 1. Backend / Node.js

Se vor adăuga mecanisme de integrare cu ecosistemul Supabase REST (prezent deja în sincronizarea de mesaje) pentru conturi.

#### [NEW] `server/supabase-accounts-sync.js`

- Modul dedicat injecției Heartbeat și a rapoartelor de status a mașinii de curent (`qr`, `open`, `close`) folosind `fetch` peste `SUPABASE_URL` și `SUPABASE_SERVICE_KEY`/`SUPABASE_ANON_KEY`.

#### [MODIFY] `server/session-manager.js`

- **Hook-uri de conectare**: În `sock.ev.on("connection.update")`, vom introduce apeluri paralele spre noua funcție Supabase pentru a replica mutațiile din Firebase:
  - Când `update === 'open'` setăm `state='connected', connected_at=now(), needs_qr_since=NULL`.
  - Când `qr` vine, setăm `needs_qr_since=now()`.
  - Când conexiunea dă `close`, declanșăm `state='disconnected', connected_at=NULL`.
- **Heartbeat Daemon**: Integrăm un `setInterval(..., 30000)` în bucla principală (sau lansat la start în `SessionManager`) care interoghează `this.sessions.keys()` având `status === 'connected'` și forțează un PING masiv (`last_ping_at = now()`) pe Supabase.

### 2. Supabase Infrastructure

Acest cod nativ va rula izolat în interiorul Supabase (SQL Editor).

#### [NEW] VIEW `wa_accounts_live`

Folosind Postgresql, vom consolida tabelele:

```sql
CREATE OR REPLACE VIEW public.wa_accounts_live AS
SELECT
  *,
  (state = 'connected' AND last_ping_at IS NOT NULL AND last_ping_at > extract(epoch from now())::bigint*1000 - 90000) AS is_online_real,
  (last_ping_at IS NULL OR last_ping_at <= extract(epoch from now())::bigint*1000 - 90000) AS is_stale
FROM public.wa_accounts;
```

> [!NOTE]
> Se vor folosi timestamp-uri BigInt millisecond bazate exact pe modul de execuție curent pentru a ne asigura că sincronizările temporale dintre Hetzner (Europa) și serverele DB din cloud lucrează izomorf fără decalaje de TimeZone-uri string.

### 3. Flutter Client UI

Odată finalizat Backend-ul, ne mutăm către repo.

#### [MODIFY] `WhatsAppMonitorScreen.dart`

- Trecem sursa listei de la `wa_accounts` la `wa_accounts_live` (dacă Supabase suportă ascultarea Realtime pe VIEW). Echipamentele alternative implică calcularea logică vizuală "in Flutter" (`if (now_ms - last_ping_at < 90000) return REAL else STALE`).

---

## Verification Plan

### Automated Tests

1. **Live Deploy via SCP Expect**: Se va împinge logica completă nouă `session-manager.js` prin bypass-ul nativ folosit ieri direct în `PM2 id 9`.
2. **Read Heartbeat**: Se vor extrage din Supabase de minim 2 ori Query-urile bazate pe coloana `last_ping_at` la interval de 30 secunde, pentru a sesiza modificarea datelor automat.

### Manual Verification

- Testare UI direct din aplicația de pe iOS prin vizitarea ecanului _Server Monitor_ și analizarea etichetelor roșu/verde "STALE"/"REAL CONNECTED".
