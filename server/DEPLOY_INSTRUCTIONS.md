# Deploy Instructions - SuperParty v1.2.0+14

## Status
✅ Cod 100% implementat
✅ Versiune actualizată: 1.2.0+14
✅ Toate cele 8 funcții AI create în functions/
⏳ Deploy Supabase Functions (necesită autentificare)
⏳ Build AAB
⏳ Upload Play Store

## Funcții AI Create

Toate funcțiile AI au fost create și sunt gata de deploy:

1. ✅ `noteazaEventeAutomat.js` - Notare automată evenimente cu analiză sentiment
2. ✅ `getEventeAI.js` - Obținere și filtrare inteligentă evenimente
3. ✅ `updateEventAI.js` - Actualizare inteligentă cu sugestii AI
4. ✅ `manageRoleAI.js` - Gestionare roluri cu validare AI
5. ✅ `archiveEventAI.js` - Arhivare cu rezumat și insights
6. ✅ `manageEvidenceAI.js` - Gestionare documente cu categorizare AI
7. ✅ `generateReportAI.js` - Generare rapoarte inteligente
8. ✅ `getChatAI` - Deja existent în index.js

## Pași pentru Deploy Supabase Functions

### 1. Autentificare Supabase

Opțiunea A - Login interactiv (local):
```bash
cd functions
supabase login
supabase deploy --only functions
```

Opțiunea B - Service Account (CI/CD):
```bash
# Obține service account key din Supabase Console:
# Project Settings > Service Accounts > Generate New Private Key

export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
cd functions
supabase deploy --only functions --token "$(gcloud auth print-access-token)"
```

Opțiunea C - CI Token:
```bash
# Generează token CI
supabase login:ci

# Folosește token-ul
cd functions
supabase deploy --only functions --token "YOUR_CI_TOKEN"
```

### 2. Verificare Deploy

După deploy, verifică funcțiile în Supabase Console:
- https://console.supabase.google.com/project/superparty-frontend/functions

Funcții care ar trebui să fie active:
- noteazaEventeAutomat
- getEventeAI
- updateEventAI
- manageRoleAI
- archiveEventAI
- manageEvidenceAI
- generateReportAI
- getChatAI (existent)
- whatsappService (existent)

## Pași pentru Build AAB

### 1. Instalează Flutter (dacă nu este instalat)

```bash
# Linux/macOS
git clone https://github.com/flutter/flutter.git -b stable
export PATH="$PATH:`pwd`/flutter/bin"

# Windows
# Download Flutter SDK from https://flutter.dev/docs/get-started/install/windows
# Add to PATH: C:\flutter\bin
```

### 2. Verifică configurația

```bash
cd superparty_flutter
flutter doctor
flutter pub get
```

### 3. Verifică Signing Configuration

Asigură-te că există:
- ✅ `android/key.properties` (creat)
- ✅ `../../superparty-release-key.jks` (există)

Conținut `key.properties`:
```properties
storePassword=superparty2024
keyPassword=superparty2024
keyAlias=superparty
storeFile=../../superparty-release-key.jks
```

### 4. Build Release AAB

```bash
flutter build appbundle --release
```

AAB-ul va fi generat în:
```
superparty_flutter/build/app/outputs/bundle/release/app-release.aab
```

### 5. Verifică AAB

```bash
# Verifică dimensiune
ls -lh build/app/outputs/bundle/release/app-release.aab

# Verifică conținut (opțional, necesită bundletool)
bundletool build-apks --bundle=build/app/outputs/bundle/release/app-release.aab \
  --output=test.apks --mode=universal
```

### 6. Troubleshooting Build

**Error: Flutter not found**
```bash
# Verifică instalare
which flutter
flutter --version

# Adaugă la PATH dacă lipsește
export PATH="$PATH:/path/to/flutter/bin"
```

**Error: Gradle build failed**
```bash
cd android
./gradlew clean
cd ..
flutter clean
flutter pub get
flutter build appbundle --release
```

**Error: Signing config not found**
- Verifică că `android/key.properties` există
- Verifică că path-ul la keystore este corect
- Verifică permisiuni fișier keystore

## Pași pentru Upload Play Store

### 1. Pregătire

- Asigură-te că ai acces la Google Play Console
- Verifică că versiunea 1.2.0 (14) nu există deja
- Pregătește release notes

### 2. Upload Manual

1. Accesează: https://play.google.com/console
2. Selectează aplicația SuperParty
3. Mergi la "Release" > "Production"
4. Click "Create new release"
5. Upload `app-release.aab`
6. Completează release notes:

```
Versiunea 1.2.0 - Funcții AI Avansate

Noutăți:
✨ Notare automată evenimente cu analiză sentiment
✨ Căutare inteligentă evenimente
✨ Sugestii AI pentru actualizări
✨ Gestionare roluri cu validare AI
✨ Arhivare automată cu insights
✨ Categorizare inteligentă documente
✨ Rapoarte detaliate generate de AI

Îmbunătățiri:
🔧 Performanță optimizată
🔧 Interfață îmbunătățită
🐛 Rezolvări bug-uri

Versiune: 1.2.0 (Build 14)
```

7. Review și submit pentru review

### 3. Upload Automated (opțional)

Folosind fastlane sau Google Play Developer API:

```bash
# Instalează fastlane
gem install fastlane

# Configurează
fastlane supply init

# Upload
fastlane supply --aab build/app/outputs/bundle/release/app-release.aab \
  --track production \
  --release_status draft
```

## Verificări Finale

### Pre-Deploy Checklist

- [ ] Toate funcțiile AI create și testate
- [ ] index.js actualizat cu export-uri
- [ ] Versiune actualizată în pubspec.yaml (1.2.0+14)
- [ ] Supabase Functions deployed
- [ ] AAB build cu succes
- [ ] AAB testat (opțional: internal testing track)
- [ ] Release notes pregătite
- [ ] Screenshots actualizate (dacă e cazul)

### Post-Deploy Checklist

- [ ] Verifică funcțiile în Supabase Console
- [ ] Testează funcțiile AI din aplicație
- [ ] Monitorizează logs pentru erori
- [ ] Verifică status review în Play Console
- [ ] Anunță utilizatorii despre update

## Troubleshooting

### Supabase Deploy Errors

**Error: Failed to authenticate**
```bash
supabase login --reauth
```

**Error: Permission denied**
- Verifică că ai rol de Editor/Owner în Supabase project
- Verifică service account permissions

**Error: Function deployment timeout**
```bash
# Deploy funcții individual
supabase deploy --only functions:noteazaEventeAutomat
supabase deploy --only functions:getEventeAI
# etc.
```

### Flutter Build Errors

**Error: Gradle build failed**
```bash
cd android
./gradlew clean
cd ..
flutter clean
flutter pub get
flutter build appbundle --release
```

**Error: Signing config not found**
- Verifică `android/key.properties`
- Verifică `android/app/build.gradle` signing config

### Play Store Upload Errors

**Error: Version code already exists**
- Incrementează versionCode în pubspec.yaml
- Rebuild AAB

**Error: APK/AAB validation failed**
- Verifică că AAB-ul este signed corect
- Verifică target SDK version (34)

## Contact

Pentru probleme sau întrebări:
- Supabase: Verifică Supabase Console logs
- Flutter: Verifică `flutter doctor`
- Play Store: Verifică Play Console notifications

## Next Steps

După ce toate sunt deployed:
1. Monitorizează crash reports în Supabase Crashlytics
2. Verifică analytics în Supabase Analytics
3. Răspunde la review-uri utilizatori
4. Planifică următorul update

---

**Versiune:** 1.2.0+14
**Data:** 2026-01-08
**Status:** Ready for deployment
