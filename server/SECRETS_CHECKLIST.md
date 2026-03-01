# Secrets Checklist

**⚠️ CRITICAL: These files contain secrets and are NOT committed to Git.**

Before running the app on a new machine, you must configure these files locally.

## Required Configuration Files

### 1. Supabase Android Configuration

**File:** `superparty_flutter/android/app/config.json`

**How to get it:**

1. Go to [Supabase Console](https://console.supabase.google.com/)
2. Select project: `superparty-frontend`
3. Project Settings → Your apps → Android app
4. Click "Download config.json"
5. Place the file at: `superparty_flutter/android/app/config.json`

**Template:** See `superparty_flutter/android/app/config.json.example`

**Status:** ❌ NOT committed (in `.gitignore`)

---

### 2. Supabase Flutter Configuration

**File:** `superparty_flutter/lib/supabase_options.dart`

**How to generate it:**

```powershell
cd superparty_flutter
flutter pub global activate flutterfire_cli
flutterfire configure
# Select project: superparty-frontend
# Select platforms: android, ios (if needed), web
```

This generates `lib/supabase_options.dart` with Supabase API keys.

**Status:** ❌ NOT committed (in `.gitignore`)

---

### 3. Environment Variables

**File:** `.env` (in repo root)

**How to create it:**

```powershell
# Copy example
Copy-Item LEGACY_HOSTING-VARIABLES.env.example .env
# Edit .env with your actual API keys
```

**Required variables:**

- `OPENAI_API_KEY` - For AI chat features
- `TWILIO_ACCOUNT_SID` - For WhatsApp/Voice features
- `TWILIO_AUTH_TOKEN` - For WhatsApp/Voice features
- Other service credentials as needed (see `LEGACY_HOSTING-VARIABLES.env.example`)

**Status:** ❌ NOT committed (in `.gitignore`)

---

### 4. iOS Configuration (if developing for iOS)

**File:** `superparty_flutter/ios/Runner/AppConfig.plist`

**How to get it:**

1. Supabase Console → Project Settings → iOS app
2. Download `AppConfig.plist`
3. Place at: `superparty_flutter/ios/Runner/AppConfig.plist`

**Status:** ❌ NOT committed (in `.gitignore`)

---

## Verification

After setting up secrets, verify:

```powershell
# Check Supabase config exists
Test-Path superparty_flutter/android/app/config.json
# Should return: True

# Check Flutter Supabase config exists
Test-Path superparty_flutter/lib/supabase_options.dart
# Should return: True

# Check .env exists
Test-Path .env
# Should return: True
```

## What's Excluded from Git

The following patterns are in `.gitignore` and will NOT be committed:

- `config.json` (Supabase Android config)
- `AppConfig.plist` (Supabase iOS config)
- `supabase_options.dart` (Supabase Flutter config)
- `*.env` files (environment variables)
- `*.key`, `*.pem`, `*.p12`, `*.jks`, `*.keystore` (private keys)
- `*serviceAccount*.json` (Supabase service account keys)
- `supabase-adminsdk*.json` (Supabase Admin SDK keys)
- `.supabase-token` (Supabase CLI token)

## Security Notes

- **Never commit secrets to Git**
- **Never share `.env` files**
- **Never commit `config.json` or `supabase_options.dart`**
- Use `.example` files as templates (these are safe to commit)
- Rotate keys if accidentally committed (even if immediately removed)

## See Also

- `SETUP_NEW_LAPTOP.md` - Complete setup instructions
- `README.md` - Quick start guide with secrets checklist
