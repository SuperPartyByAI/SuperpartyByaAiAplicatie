# Flutter Crashlytics — Build & Setup Guide

## Ce e implementat

### CrashlyticsHelper (`lib/services/crashlytics_helper.dart`)

- FlutterError.onError → Crashlytics (fatal)
- PlatformDispatcher.onError → Crashlytics (fatal)
- Colectare oprit în debug mode
- Custom keys: `environment`, `buildNumber`, `device`, `androidSdk`/`iosVersion`

### Custom Keys setate automat

| Key             | Când se setează                               |
| --------------- | --------------------------------------------- |
| `userId`        | La autentificare (ApprovalGate)               |
| `email`         | La autentificare                              |
| `environment`   | La init (`production`/`debug`)                |
| `buildNumber`   | La init (din `--dart-define`)                 |
| `device`        | La init (manufacturer + model)                |
| `lastRequestId` | La fiecare HTTP response (din `X-Request-Id`) |

### App Check

- **Android**: Play Integrity (release) / Debug Token (debug)
- **iOS**: DeviceCheck (release) / Debug Token (debug)

---

## Build Android (Release cu Symbols)

```bash
# Build APK cu Crashlytics symbols upload
flutter build apk --release \
  --dart-define=BUILD_NUMBER=$(date +%Y%m%d%H%M)

# SAU App Bundle
flutter build appbundle --release \
  --dart-define=BUILD_NUMBER=$(date +%Y%m%d%H%M)
```

### ProGuard / R8 mapping upload

Crashlytics Gradle plugin uploadează automat `mapping.txt` la build time.
Verificare: Supabase Console → Crashlytics → breadcrumb „Upload mapping file".

### Native symbols (NDK crashes)

Dacă ai native crashes:

```bash
# Upload NDK symbols manual
supabase crashlytics:symbols:upload --app=1:YOUR_APP_ID:android:YOUR_HASH \
  build/app/intermediates/merged_native_libs/release/out/lib/
```

---

## Build iOS (Release cu dSYM)

```bash
flutter build ipa --release \
  --dart-define=BUILD_NUMBER=$(date +%Y%m%d%H%M)
```

### dSYM upload

Xcode uploadează automat dSYMs dacă ai configurat run script phase:

1. Xcode → Runner → Build Phases → + → New Run Script Phase
2. Script:

```bash
"${PODS_ROOT}/SupabaseCrashlytics/run"
```

3. Input Files:

```
$(SRCROOT)/$(BUILT_PRODUCTS_DIR)/$(INFOPLIST_PATH)
${DWARF_DSYM_FOLDER_PATH}/${DWARF_DSYM_FILE_NAME}/Contents/Resources/DWARF/${TARGET_NAME}
```

### Upload manual dSYM

```bash
supabase crashlytics:symbols:upload --app=1:YOUR_APP_ID:ios:YOUR_HASH \
  build/ios/archive/Runner.xcarchive/dSYMs/
```

---

## Test Crash (Verificare)

```dart
// Adaugă temporar într-un buton sau la startup
throw Exception("Test Crash from SuperParty");
```

### Verificare în Supabase Console

1. Supabase Console → Crashlytics
2. Ar trebui să apară crash-ul în ~5 minute
3. Click pe crash → verifică:
   - `userId` ✅
   - `environment` ✅
   - `buildNumber` ✅
   - `lastRequestId` ✅
   - Stack trace deobfuscat ✅

---

## Corelarea end-to-end

1. User face un request → backend generează `X-Request-Id: abc123`
2. Flutter interceptor (în `backend_service.dart`) citește header-ul
3. Setează ca Crashlytics custom key: `lastRequestId = abc123`
4. Dacă app-ul crashează → în Supabase Console vezi `lastRequestId = abc123`
5. Caută `abc123` în Grafana Loki: `{service="superparty-backend"} |= "abc123"`
6. Găsești log-ul exact cu path, status, latency, și mai mult context

Asta e **true end-to-end correlation**.
