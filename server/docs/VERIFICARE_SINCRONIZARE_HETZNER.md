# Verificare: Sincronizarea conversațiilor (Hetzner)

Pași pentru a confirma că deploy-ul pe Hetzner e făcut și că mesajele noi se sincronizează corect.

---

## 1. Verifică că backend-ul rulează și răspunde (`/diag`)

Din terminal (de pe mașina ta, dacă portul 8080 e accesibil din exterior):

```bash
curl -s http://37.27.34.179:8080/diag | head -50
```

**Sau** pe server (SSH):

```bash
ssh root@37.27.34.179 "curl -s http://127.0.0.1:8080/diag"
```

**Trebuie să vezi:**
- `HTTP/1.1 200 OK` (nu 404)
- JSON cu: `ready`, `mode`, `databaseConnected`, `timestamp`

- Dacă **404** → pe Hetzner rulează încă o versiune veche; trebuie deploy (pasul 2).
- Dacă **200** și `mode: "active"`, `databaseConnected: true` → backend-ul e OK pentru pasul 3.

---

## 2. Deploy pe Hetzner (dacă `/diag` dă 404 sau vrei codul cu `ensureJidString`)

**2.1 Află directorul backend pe server:**

```bash
ssh root@37.27.34.179 "systemctl cat whatsapp-backend"
```

Caută linia `WorkingDirectory=...` (ex: `/opt/whatsapp/Aplicatie-SuperpartyByAi/whatsapp-backend`).

**2.2 Deploy.** Pe acest server directorul efectiv e (din `systemctl cat` → override `30-path.conf`):

`/opt/whatsapp/Aplicatie-SuperpartyByAi/whatsapp-backend`

Comandă exactă (fără placeholder):

```bash
ssh root@37.27.34.179 "cd /opt/whatsapp/Aplicatie-SuperpartyByAi/whatsapp-backend && git pull && npm ci --omit=dev && systemctl restart whatsapp-backend"
```

Dacă pe alt server ai alt `WorkingDirectory`, înlocuiește calea din comandă cu valoarea de la 2.1.

**2.3 Verifică din nou `/diag` (pasul 1).** După restart, ar trebui să primești 200 și JSON.

**Notă env:** `WHATSAPP_SYNC_FULL_HISTORY` trebuie să **nu fie** `false` ca să ruleze full history la re-pair (implicit `true`). Dacă e `false`, la Disconnect → Connect → Scan QR nu se importă lista de chat-uri și mesajele.

---

## 3. Confirmă că pe server e codul cu `ensureJidString`

Pe Hetzner, în directorul backend:

```bash
ssh root@37.27.34.179 "cd \$(systemctl show whatsapp-backend -p WorkingDirectory --value) && grep -c ensureJidString server.js"
```

Rezultat **cel puțin 1** (ideal mai multe) = fix-ul pentru `[object Object]` e prezent. Dacă e **0**, deploy-ul nu s-a făcut în directorul corect sau nu s-a făcut `git pull`.

---

## 4. Verificare mesaje noi (sincronizare live)

1. **Trimite un mesaj WhatsApp** (sau primește unul) într-o conversație legată de un cont din aplicație.
2. **În Database** (Console):  
   `threads` → un document cu ID de forma `{accountId}__{număr}@s.whatsapp.net` → subcolecția `messages`.  
   Ar trebui să apară un document nou cu mesajul (fără `[object Object]` în ID-ul thread-ului).
3. **În aplicație (Inbox Angajați)** conversația respectivă ar trebui să se actualizeze cu mesajul nou.

Dacă mesajul nou apare în Database și în app → sincronizarea merge.

---

## 5. Istoric (backfill) – „Sync / Backfill history”

- Din aplicație: **Inbox Angajați** → meniul (⋯) la contul dorit → **Sync / Backfill history**.
- Doar angajații (nu doar super-admin) pot rula acest sync.
- După ce rulează, în Database la `accounts/{accountId}` se actualizează câmpuri ca `lastAutoBackfillAttemptAt`, `lastAutoBackfillSuccessAt`, `lastAutoBackfillStatus`.

---

## Rezumat rapid

| Pas | Comandă / acțiune | Success |
|-----|--------------------|--------|
| 1   | `curl -s http://37.27.34.179:8080/diag` | 200 + JSON, `mode: active`, `databaseConnected: true` |
| 2   | SSH → `cd /opt/whatsapp/.../whatsapp-backend && git pull && npm ci --omit=dev && systemctl restart whatsapp-backend` | Fără erori |
| 3   | `grep -c ensureJidString server.js` pe server | ≥ 1 |
| 4   | Mesaj nou WhatsApp → Database + app | Mesajul apare în ambele |
| 5   | „Sync / Backfill history” din app | Istoricul se completează (verifici în Database) |

Dacă pașii 1–4 sunt OK, **conversațiile se sincronizează** (mesaje noi + backfill din pasul 5).

---

## 5a. Loguri așteptate la re-pair (history sync)

După **Disconnect → Connect → Scan QR**, pe Hetzner (`journalctl -u whatsapp-backend -f`) ar trebui să apară:

```
📚 [accountId] messaging-history.set event received; history chats: N
📚 [accountId] messaging-history.set, Thread placeholders from history chats: X created.
```

- Dacă `X > 0`: s-au creat thread placeholders; Inbox va afișa conversațiile.
- Dacă `X = 0`: se loghează și motivul (`history empty`, `all existed or skipped`, `dry run`, etc.).

Exemplu: `messaging-history.set, Thread placeholders from history chats: 42 created.`

---

## 6. De ce nu văd conversațiile în Inbox Angajați?

**Inbox Angajați** = ecranul **Staff** (`inbox-staff`). Lista vine din Database `threads` (query pe `accountId` + `lastMessageAt`). Dacă nu vezi conversații, urmează pașii de mai jos.

### 6.1 Ce vezi exact în app?

| Ce vezi | Cauză probabilă | Ce să faci |
|--------|------------------|------------|
| **„Nu există conturi conectate pentru Inbox Angajați.”** | 0 conturi conectate **sau** toate excluse (ex. doar admin 0737571397). | Conectează cel puțin un cont **non-admin** în **Manage Accounts**. Inbox exclude contul admin. |
| **„Nu există conversații pentru conturile angajaților...”** | Conturi conectate, dar **0 thread-uri** în Database pentru acele `accountId`. | Vezi 6.2 și 6.3. |
| **„Index mismatch. Verifică indexurile Database...”** | Index lipsă pentru `threads` (accountId + lastMessageAt). | `supabase deploy --only database:indexes` și așteaptă indexul. |
| **„Rules/RBAC blocked...”** | Reguli Database blochează citirea pe `threads`. | Verifică `database.rules` (angajații pot citi thread-uri care nu sunt în `adminOnlyAccountIds`). |

### 6.2 Verifică că există thread-uri în Database

Folosește `accountId`-urile din `/diag` (ex. `a6c9ff8d:45`, `9c20d498:45`, `a002401e:45`). Rulează:

```bash
cd /Users/universparty/Aplicatie-SuperpartyByAi
node scripts/audit_whatsapp_inbox_schema.mjs --project superparty-frontend \
  --accountId "a6c9ff8d:45" --accountId "9c20d498:45" --accountId "a002401e:45"
```

Dacă scriptul raportează **0 threads** pentru toate → nu există ingestie (încă) pentru acele conturi. Vezi 6.3.

### 6.3 Nu există thread-uri (0 în Database)

- **Backfill** completează doar thread-uri **deja existente**. Dacă nu există niciun thread, backfill-ul nu creează thread-uri noi.
- **Ce creează thread-uri:**
  1. **History sync** la pairing (scan QR) / re-pair: backend-ul primește `messaging-history.set`, creează **thread placeholders** din `chats` (pentru toate conversațiile) și salvează mesajele. Inbox arată conversațiile; backfill le poate umple cu istoric.
  2. **Mesaje noi** (realtime): la primul mesaj primit/trimis pentru un chat, backend-ul creează thread-ul dacă nu există.

**Pași recomandați:**

1. **Sync / Backfill** din app (Inbox Angajați → ⋯ → Sync / Backfill history) pentru conturile conectate. Dacă deja există thread-uri, le umple cu istoric.
2. Dacă tot **0 conversații:** **re-pair** contul (Manage Accounts → disconnect → connect → scan QR din nou). Asta declanșează history sync, creează placeholders din `chats` + salvează mesajele.
3. Alternativ: **trimite sau primește mesaje noi** pe acel cont. Backend-ul creează thread-ul la primul mesaj.
4. Verifică pe Hetzner că `mode: "active"` și `databaseConnected: true` (`curl .../diag`). Fără backend activ, nu se scrie nimic în Database.

### 6.4 Verificare rapidă (recap)

1. **Manage Accounts:** ai cel puțin un cont **conectat** care **nu** e admin (0737571397)?
2. **Backend:** `curl -s http://37.27.34.179:8080/diag` → `mode: "active"`, `databaseConnected: true`?
3. **Database:** rulezi `audit_whatsapp_inbox_schema.mjs` pentru `accountId`-urile conectate → există thread-uri?
4. **App:** ai apăsat **Sync / Backfill history** (⋯ meniu) și apoi **Reîmprospătare**?
5. Dacă tot 0: **re-pair** contul (QR) sau așteaptă **mesaje noi** pe acel WhatsApp.
