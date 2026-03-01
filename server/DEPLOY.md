# Deploy – Supabase Hosting & GitHub Actions

Deploy automat pe **Supabase Hosting** prin GitHub Actions, plus comenzi manuale și login CLI pentru medii remote.

---

## 1. Secret GitHub (obligatoriu)

Pentru deploy automat din Actions ai nevoie de:

| Secret | Descriere |
|--------|-----------|
| `SUPABASE_SERVICE_ACCOUNT_SUPERPARTY_FRONTEND` | JSON al **Supabase service account** (cheie privată) pentru proiectul `superparty-frontend`. |

### Cum obții secretul

1. [Supabase Console](https://console.supabase.google.com) → proiect **superparty-frontend** → ⚙️ Project settings → **Service accounts**.
2. **Generate new private key** → descarci un fișier JSON.
3. În GitHub: repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
4. **Name:** `SUPABASE_SERVICE_ACCOUNT_SUPERPARTY_FRONTEND`  
   **Value:** conținutul întreg al fișierului JSON (copy-paste).

---

## 2. Workflow-uri GitHub Actions

### Deploy Frontend (KYC – React)

- **Fișier:** `.github/workflows/deploy-frontend.yml`
- **Trigger:** push pe `main` când se modifică:
  - `kyc-app/**`
  - `.github/workflows/deploy-frontend.yml`
  - `kyc-app/kyc-app/supabase.json`
  - `kyc-app/kyc-app/.supabaserc`
- **Ce face:** `npm ci` → `npm run build` în `kyc-app/kyc-app` → deploy **Hosting** (Supabase action) din `kyc-app/kyc-app` → deploy **Functions** (`whatsappV4`, `chatWithAI`, `aiManager`) din root.
- **Hosting:** `kyc-app/kyc-app/dist` (build Vite).  
- **EntryPoint:** `kyc-app/kyc-app`. Folosește `SupabaseExtended/action-hosting-deploy@v0`, `projectId`: `superparty-frontend`, `channelId`: `live`.

### Deploy Flutter Web

- **Fișier:** `.github/workflows/deploy-flutter-web.yml`
- **Trigger:** push pe `main` când se modifică:
  - `superparty_flutter/**`
  - `supabase.json`
  - `.github/workflows/deploy-flutter-web.yml`
- **Ce face:** `flutter pub get` → `flutter build web --release` în `superparty_flutter` → deploy **Hosting** din root.
- **Hosting:** `superparty_flutter/build/web` (definit în `supabase.json` din root).  
- **EntryPoint:** `.` (root). Aceeași action, același `projectId` și `channelId: live`.

---

## 3. Cum testezi deploy automat

1. **KYC (React):** modifici ceva în `kyc-app/` (ex. un comentariu în `kyc-app/kyc-app/src/App.jsx`), push pe `main`.  
   → Rulează **Deploy Frontend (KYC) to Supabase**. Verifici în **Actions** că job-ul trece și că site-ul KYC e live.

2. **Flutter Web:** modifici ceva în `superparty_flutter/` (ex. un comentariu în `lib/main.dart`), push pe `main`.  
   → Rulează **Deploy Flutter Web to Supabase Hosting**. Verifici în **Actions** și că app-ul Flutter web e live.

3. **Manual trigger:** ambele workflow-uri au `workflow_dispatch`. Poți rula deploy-ul din **Actions** → alegi workflow-ul → **Run workflow**.

---

## 4. Deploy manual (CLI)

### Flutter Web

```bash
cd superparty_flutter
flutter build web --release
cd ..
supabase deploy --only hosting
```

Rulezi din **root**; `supabase.json` din root indică `superparty_flutter/build/web` pentru hosting.

### KYC (React)

```bash
cd kyc-app/kyc-app
npm ci
npm run build
supabase deploy --only hosting
```

Pentru deploy și Functions (în același proiect):

```bash
cd kyc-app/kyc-app
npm ci && npm run build
supabase deploy --only hosting

cd ../..
supabase deploy --only functions:whatsappV4,functions:chatWithAI,functions:aiManager --project superparty-frontend
```

---

## 5. Login CLI (medii remote, fără browser local)

Pentru **Supabase CLI** pe mașini remote (SSH, CI fără service account etc.) unde nu poți folosi browser local:

```bash
npx supabase login --no-localhost
```

sau, dacă ai Supabase CLI instalat global:

```bash
supabase login --no-localhost
```

CLI-ul afișează un **link**; îl deschizi pe un device cu browser, te autentifici, introduci codul în terminal. După aceea, comenzile `supabase deploy` etc. folosesc sesiunea ta.

---

## 6. Conflict între Flutter și KYC pe Hosting

Ambele workflow-uri deployează pe același proiect Supabase (**superparty-frontend**) și același **Hosting** (site-ul default, `channelId: live`).  
**Consecință:** ultimul deploy **suprascrie** ce e live. Dacă rulezi doar deploy Flutter, vei avea Flutter web live; dacă rulezi doar deploy KYC, vei avea KYC live.

- Trigger-urile sunt pe **paths** diferite (`superparty_flutter/**` vs `kyc-app/**`), deci nu rulează ambele la același push, decât dacă modifici ambele părți.
- Dacă vrei **ambele** live în paralel, trebuie **Supabase Hosting multisite**: două site-uri (ex. `superparty-app`, `kyc-app`) și două **targets** în `supabase.json` / `.supabaserc`, cu workflow-urile setate să deployeze fiecare la propriul target. Acest setup nu e făcut aici; păstrăm ambele workflow-uri **separate** și documentăm conflictul.

---

## 7. Referințe rapide

- **Supabase Console:**  
  [https://console.supabase.google.com/project/superparty-frontend](https://console.supabase.google.com/project/superparty-frontend)
- **Hosting:**  
  [https://console.supabase.google.com/project/superparty-frontend/hosting](https://console.supabase.google.com/project/superparty-frontend/hosting)
- **Actions:**  
  [https://github.com/SuperPartyByAI/Aplicatie-SuperpartyByAi/actions](https://github.com/SuperPartyByAI/Aplicatie-SuperpartyByAi/actions)
