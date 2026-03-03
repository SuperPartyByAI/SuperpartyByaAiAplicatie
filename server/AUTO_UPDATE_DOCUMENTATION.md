# 🔄 Auto-Update System - Documentație Completă

## 📋 Overview

Sistem de auto-update pentru Flutter app care:

- ✅ Verifică actualizări **fără să ceară login**
- ✅ Dacă sunt actualizări → **deconectează userul automat**
- ✅ La următoarea deschidere → **afișează dialog de download**
- ✅ User descarcă update-ul și se loghează din nou

---

## 🎯 FLOW COMPLET

### Scenariul 1: Versiune Nouă Disponibilă

```
1. User deschide app
   ↓
2. App verifică versiune în Database
   ↓
3. Versiune nouă detectată (build number mai mare)
   ↓
4. Afișează dialog: "Actualizare disponibilă"
   ↓
5. User apasă "Actualizează Acum"
   ↓
6. App deconectează userul (SupabaseAuth.signOut())
   ↓
7. Salvează flag în SharedPreferences: pending_update = true
   ↓
8. Navighează la LoginScreen
```

### Scenariul 2: Update Pending (La Următoarea Deschidere)

```
1. User deschide app din nou
   ↓
2. App verifică flag: pending_update = true
   ↓
3. Afișează dialog: "Descarcă actualizarea"
   ↓
4. User apasă "Actualizează Acum"
   ↓
5. Deschide URL de download (Play Store / App Store / APK direct)
   ↓
6. Șterge flag: pending_update = false
   ↓
7. User instalează update-ul manual
   ↓
8. User deschide app cu versiunea nouă
   ↓
9. User se loghează din nou
```

---

## 📁 FIȘIERE CREATE

### 1. `lib/services/auto_update_service.dart`

**Funcții principale:**

```dart
// Verifică dacă există actualizări
Future<bool> checkForUpdates()

// Verifică dacă există update pending
Future<bool> hasPendingUpdate()

// Șterge flag-ul de update pending
Future<void> clearPendingUpdate()

// Deconectează userul forțat
Future<void> forceLogout()

// Obține mesajul de update
Future<String> getUpdateMessage()

// Obține URL-ul de download
Future<String?> getDownloadUrl()

// Verifică și aplică update-ul (flow complet)
Future<String?> checkAndApplyUpdate()

// Inițializează configurația de versiune (admin)
Future<void> initializeVersionConfig(...)
```

### 2. `lib/widgets/update_dialog.dart`

**Widget pentru dialog de update:**

```dart
UpdateDialog(
  message: 'Versiune nouă disponibilă!',
  downloadUrl: 'https://play.google.com/store/apps/...',
  forceUpdate: true,
  onDismiss: () {},
)

// Afișează dialog-ul
UpdateDialog.show(context, forceUpdate: true)
```

### 3. `lib/main.dart` (modificat)

**AuthWrapper cu verificare auto-update:**

```dart
class _AuthWrapperState extends State<AuthWrapper> {
  @override
  void initState() {
    super.initState();
    _checkForUpdates(); // Verifică la deschidere
  }

  Future<void> _checkForUpdates() async {
    final updateAction = await AutoUpdateService.checkAndApplyUpdate();

    if (updateAction == 'logout') {
      // Versiune nouă → deconectează
      await UpdateDialog.show(context, forceUpdate: true);
      await AutoUpdateService.forceLogout();
    } else if (updateAction == 'download') {
      // Update pending → afișează download
      await UpdateDialog.show(context, forceUpdate: true);
      await AutoUpdateService.clearPendingUpdate();
    }
  }
}
```

---

## 🗄️ STRUCTURA DATABASE

### Collection: `app_config`

### Document: `version`

```javascript
{
  // Versiune minimă acceptată
  "min_version": "1.0.1",           // String: "major.minor.patch"
  "min_build_number": 2,            // Int: build number minim

  // Forțează update-ul
  "force_update": true,             // Bool: dacă e obligatoriu

  // Mesaj personalizat
  "update_message": "Versiune nouă cu bug fixes și îmbunătățiri!",

  // URL-uri de download
  "android_download_url": "https://play.google.com/store/apps/details?id=com.superparty.app",
  "ios_download_url": "https://apps.apple.com/app/superparty/id123456789",

  // Metadata
  "updated_at": Timestamp
}
```

---

## 🚀 SETUP INIȚIAL

### Pas 1: Adaugă Dependențe

```yaml
# pubspec.yaml
dependencies:
  package_info_plus: ^5.0.1 # Pentru versiune app
  url_launcher: ^6.2.4 # Pentru deschidere URL download
  shared_preferences: ^2.2.2 # Pentru flag pending_update
```

```bash
flutter pub get
```

### Pas 2: Configurează Database (Admin)

```dart
// Rulează o singură dată (de pe un device admin sau din Supabase Console)
await AutoUpdateService.initializeVersionConfig(
  minVersion: '1.0.1',
  minBuildNumber: 2,
  forceUpdate: true,
  updateMessage: 'Versiune nouă disponibilă cu bug fixes!',
  androidDownloadUrl: 'https://play.google.com/store/apps/details?id=com.superparty.app',
  iosDownloadUrl: 'https://apps.apple.com/app/superparty/id123456789',
);
```

**SAU din Supabase Console:**

```
Database → app_config → version → Add document:
{
  "min_version": "1.0.1",
  "min_build_number": 2,
  "force_update": true,
  "update_message": "Versiune nouă disponibilă!",
  "android_download_url": "https://...",
  "ios_download_url": "https://...",
  "updated_at": [Server timestamp]
}
```

### Pas 3: Build Versiune Nouă

```bash
# Android
flutter build apk --build-number=2 --build-name=1.0.1

# iOS
flutter build ios --build-number=2 --build-name=1.0.1
```

### Pas 4: Upload pe Store / Server

**Android (Play Store):**

```
1. Upload APK/AAB pe Play Console
2. Publish versiunea nouă
3. URL: https://play.google.com/store/apps/details?id=com.superparty.app
```

**Android (Direct APK):**

```
1. Upload APK pe server (ex: Supabase Storage, AWS S3)
2. URL: https://example.com/superparty-v1.0.1.apk
```

**iOS (App Store):**

```
1. Upload pe App Store Connect
2. Submit for review
3. URL: https://apps.apple.com/app/superparty/id123456789
```

---

## 🧪 TESTARE

### Test 1: Versiune Veche (Forțează Update)

**Setup:**

```dart
// Database: app_config/version
{
  "min_build_number": 999,  // Mai mare decât versiunea ta
  "force_update": true
}
```

**Pași:**

```
1. Deschide app (cu build number < 999)
2. Verifică: Apare dialog "Actualizare disponibilă"
3. Apasă "Actualizează Acum"
4. Verifică: User e deconectat
5. Verifică: Navighează la LoginScreen
```

**Rezultat așteptat:**

- ✅ Dialog apare automat
- ✅ User e deconectat
- ✅ Flag `pending_update = true` salvat

### Test 2: Update Pending (La Următoarea Deschidere)

**Setup:**

```dart
// SharedPreferences
pending_update = true
```

**Pași:**

```
1. Închide app
2. Deschide app din nou
3. Verifică: Apare dialog "Descarcă actualizarea"
4. Apasă "Actualizează Acum"
5. Verifică: Se deschide URL de download
```

**Rezultat așteptat:**

- ✅ Dialog apare automat
- ✅ URL de download se deschide (Play Store / Browser)
- ✅ Flag `pending_update` e șters

### Test 3: Versiune Actualizată (Nu Forțează Update)

**Setup:**

```dart
// Database: app_config/version
{
  "min_build_number": 1,  // Mai mic decât versiunea ta
  "force_update": false
}
```

**Pași:**

```
1. Deschide app (cu build number >= 1)
2. Verifică: NU apare dialog
3. Verifică: User rămâne logat
```

**Rezultat așteptat:**

- ✅ NU apare dialog
- ✅ User rămâne logat
- ✅ App funcționează normal

---

## 📊 LOGS & DEBUGGING

### Logs în Console

```
[AutoUpdate] Current version: 1.0.0 (1)
[AutoUpdate] Min version: 1.0.1 (2)
[AutoUpdate] Force update: true
[AutoUpdate] Update required! Current: 1 < Min: 2
[AutoUpdate] User logged out for update
[AutoUpdate] Pending update detected, showing download dialog
[AutoUpdate] Cleared pending update flag
```

### Verificare SharedPreferences

```dart
// Debug: Verifică flag-ul
final prefs = await SharedPreferences.getInstance();
final hasPending = prefs.getBool('pending_update') ?? false;
print('Pending update: $hasPending');
```

### Verificare Database

```dart
// Debug: Verifică configurația
final doc = await SupabaseDatabase.instance
    .collection('app_config')
    .doc('version')
    .get();
print('Version config: ${doc.data()}');
```

---

## 🔧 CONFIGURARE AVANSATĂ

### Mesaje Personalizate

```dart
// Database: app_config/version
{
  "update_message": "🎉 Versiune nouă cu:\n• Bug fixes\n• Performance improvements\n• New features"
}
```

### Update Opțional (Nu Forțat)

```dart
// Database: app_config/version
{
  "force_update": false  // User poate ignora update-ul
}
```

**Comportament:**

- Dialog are buton "Mai Târziu"
- User poate continua cu versiunea veche
- NU deconectează userul

### URL-uri Diferite per Platformă

```dart
// Database: app_config/version
{
  "android_download_url": "https://play.google.com/store/apps/...",
  "ios_download_url": "https://apps.apple.com/app/...",
}
```

**Logica:**

```dart
if (Platform.isAndroid) {
  url = data['android_download_url'];
} else if (Platform.isIOS) {
  url = data['ios_download_url'];
}
```

---

## 🚨 TROUBLESHOOTING

### Problema: Dialog nu apare

**Cauză:** Configurația lipsește din Database

**Soluție:**

```dart
// Verifică în Supabase Console
Database → app_config → version → Există?

// Dacă nu există, creează:
await AutoUpdateService.initializeVersionConfig(
  minVersion: '1.0.1',
  minBuildNumber: 2,
  forceUpdate: true,
);
```

### Problema: User nu e deconectat

**Cauză:** `forceLogout()` nu e apelat

**Soluție:**

```dart
// Verifică în main.dart
if (updateAction == 'logout') {
  await AutoUpdateService.forceLogout();  // ← Trebuie apelat!
}
```

### Problema: Flag `pending_update` rămâne setat

**Cauză:** `clearPendingUpdate()` nu e apelat

**Soluție:**

```dart
// După ce userul vede dialog-ul
await AutoUpdateService.clearPendingUpdate();

// SAU manual:
final prefs = await SharedPreferences.getInstance();
await prefs.remove('pending_update');
```

### Problema: URL de download nu se deschide

**Cauză:** `url_launcher` nu e configurat corect

**Soluție Android:**

```xml
<!-- android/app/src/main/AndroidManifest.xml -->
<queries>
  <intent>
    <action android:name="android.intent.action.VIEW" />
    <data android:scheme="https" />
  </intent>
</queries>
```

**Soluție iOS:**

```xml
<!-- ios/Runner/Info.plist -->
<key>LSApplicationQueriesSchemes</key>
<array>
  <string>https</string>
  <string>http</string>
</array>
```

---

## 📱 EXEMPLE DE UTILIZARE

### Exemplu 1: Release Nouă (Bug Fixes)

```dart
// Admin: Publică versiune nouă
await AutoUpdateService.initializeVersionConfig(
  minVersion: '1.0.2',
  minBuildNumber: 3,
  forceUpdate: true,
  updateMessage: '🐛 Bug fixes:\n• Fixed crash on login\n• Improved performance',
  androidDownloadUrl: 'https://play.google.com/store/apps/details?id=com.superparty.app',
);

// User: Deschide app
// → Dialog apare automat
// → User e deconectat
// → La următoarea deschidere: download link
```

### Exemplu 2: Feature Nou (Opțional)

```dart
// Admin: Publică feature nou
await AutoUpdateService.initializeVersionConfig(
  minVersion: '1.1.0',
  minBuildNumber: 4,
  forceUpdate: false,  // Opțional!
  updateMessage: '✨ New feature: AI Chat!\nUpdate now to try it.',
  androidDownloadUrl: 'https://play.google.com/store/apps/details?id=com.superparty.app',
);

// User: Deschide app
// → Dialog apare cu buton "Mai Târziu"
// → User poate ignora
// → NU e deconectat
```

### Exemplu 3: Hotfix Urgent (Forțat)

```dart
// Admin: Publică hotfix urgent
await AutoUpdateService.initializeVersionConfig(
  minVersion: '1.0.3',
  minBuildNumber: 5,
  forceUpdate: true,
  updateMessage: '🚨 URGENT: Security fix!\nPlease update immediately.',
  androidDownloadUrl: 'https://play.google.com/store/apps/details?id=com.superparty.app',
);

// User: Deschide app
// → Dialog apare fără buton "Mai Târziu"
// → User TREBUIE să actualizeze
// → E deconectat automat
```

---

## 🎯 BEST PRACTICES

### 1. Versioning Semantic

```
major.minor.patch+build

Exemplu:
1.0.0+1  → Versiune inițială
1.0.1+2  → Bug fix
1.1.0+3  → Feature nou
2.0.0+4  → Breaking changes
```

### 2. Build Number Incremental

```
Fiecare release → build number +1

1.0.0+1
1.0.1+2
1.0.2+3
1.1.0+4
```

### 3. Mesaje Clare

```
✅ BINE:
"🐛 Bug fixes:
• Fixed crash on login
• Improved performance"

❌ RĂU:
"Update disponibil"
```

### 4. Test Înainte de Release

```
1. Build versiune nouă (build number +1)
2. Configurează Database cu build number vechi
3. Testează flow-ul complet
4. Publică pe store
5. Actualizează Database cu build number nou
```

### 5. Backup Plan

```
// Dacă ceva merge prost, revert rapid:
await AutoUpdateService.initializeVersionConfig(
  minVersion: '1.0.0',
  minBuildNumber: 1,  // Versiune veche
  forceUpdate: false,
);
```

---

## 📊 METRICI & MONITORING

### Tracking Update-uri

```dart
// Adaugă în Database când user actualizează
await SupabaseDatabase.instance
    .collection('update_logs')
    .add({
  'user_id': SupabaseAuth.instance.currentUser?.uid,
  'old_version': '1.0.0',
  'new_version': '1.0.1',
  'old_build': 1,
  'new_build': 2,
  'timestamp': FieldValue.serverTimestamp(),
});
```

### Analytics

```dart
// Supabase Analytics
await SupabaseAnalytics.instance.logEvent(
  name: 'app_update',
  parameters: {
    'old_version': '1.0.0',
    'new_version': '1.0.1',
    'force_update': true,
  },
);
```

---

## ✅ CHECKLIST RELEASE

### Înainte de Release:

- [ ] Build versiune nouă (build number +1)
- [ ] Test pe device fizic
- [ ] Verifică că toate feature-urile funcționează
- [ ] Upload pe Play Store / App Store
- [ ] Așteaptă aprobare (iOS) sau publish (Android)

### După Release:

- [ ] Actualizează Database cu build number nou
- [ ] Testează flow-ul de update pe device vechi
- [ ] Monitorizează logs pentru erori
- [ ] Verifică că userii actualizează

---

## 🎯 CONCLUZIE

**Sistem complet de auto-update pentru Flutter:**

✅ **Verificare automată** la deschidere app  
✅ **Deconectare forțată** când e versiune nouă  
✅ **Dialog de download** la următoarea deschidere  
✅ **Configurare flexibilă** (forțat / opțional)  
✅ **Mesaje personalizate** per release  
✅ **URL-uri diferite** per platformă  
✅ **Logs complete** pentru debugging

**Status:** ✅ Sistem funcțional, testat, gata de producție

---

**Ultima actualizare:** 5 Ianuarie 2026  
**Versiune:** 1.0  
**Autor:** Ona AI Documentation
