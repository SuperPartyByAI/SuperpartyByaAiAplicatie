# 📥 Download Direct din Supabase Storage

## 🎯 OBIECTIV

În loc să descarce APK-ul de pe Play Store sau din mail, userii vor descărca **DIRECT din Supabase Storage**.

---

## 📋 CONFIGURARE DATABASE

### Pasul 1: Creează documentul în Database

**În Supabase Console (link-ul tău):**

```
https://console.supabase.google.com/project/superparty-frontend/database
```

**Collection:** `app_config`  
**Document ID:** `version`

**Câmpuri:**

```javascript
{
  "min_version": "1.0.1",
  "min_build_number": 999,
  "force_update": true,
  "update_message": "🎉 Versiune nouă disponibilă! Descarcă direct din Supabase.",

  // Link direct Supabase Storage
  "android_download_url": "https://supabasestorage.googleapis.com/v0/b/superparty-frontend.appspot.com/o/apk%2Fsuperparty-v1.0.1.apk?alt=media",

  "ios_download_url": "https://apps.apple.com/app/superparty/id123456789"
}
```

---

## 📤 UPLOAD APK ÎN SUPABASE STORAGE

### Pasul 2: Upload APK

**Mergi la Supabase Storage:**

```
https://console.supabase.google.com/project/superparty-frontend/storage
```

**Pași:**

1. **Creează folder `apk`:**
   - Click **"Create folder"**
   - Nume: `apk`
   - Click **"Create"**

2. **Upload APK:**
   - Intră în folder `apk`
   - Click **"Upload file"**
   - Selectează fișierul APK
   - Așteaptă upload-ul

3. **Redenumește (opțional):**
   - Click pe fișier → **"..."** → **"Rename"**
   - Nume: `superparty-v1.0.1.apk`

4. **Obține URL de download:**
   - Click pe fișier
   - Click **"Get download URL"** (sau "Copy download URL")
   - Copiază URL-ul

5. **Actualizează Database:**
   - Mergi înapoi la Database
   - Deschide documentul `app_config/version`
   - Editează câmpul `android_download_url`
   - Lipește URL-ul copiat
   - Click **"Update"**

---

## 🔓 SETEAZĂ PERMISIUNI PUBLICE

### Pasul 3: Configurează Storage Rules

**Mergi la Storage Rules:**

```
https://console.supabase.google.com/project/superparty-frontend/storage/rules
```

**Adaugă regula:**

```javascript
rules_version = '2';
service supabase.storage {
  match /b/{bucket}/o {
    // Permite download public pentru APK-uri
    match /apk/{fileName} {
      allow read: if true;  // Oricine poate descărca
      allow write: if false; // Doar admin poate upload
    }

    // Restul fișierelor - autentificare necesară
    match /{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

**Pași:**

1. Click **"Edit rules"**
2. Înlocuiește conținutul cu regula de mai sus
3. Click **"Publish"**

---

## 🧪 TESTARE

### Pasul 4: Testează download-ul

**Opțiunea 1: Test în browser**

1. Copiază URL-ul din `android_download_url`
2. Deschide într-un browser nou (incognito)
3. Verifică că începe download-ul APK-ului

**Opțiunea 2: Test în app**

1. Rulează app: `flutter run`
2. Apare dialog "Actualizare Disponibilă"
3. Click "Actualizează Acum"
4. Se deschide browser cu URL-ul
5. Începe download-ul APK-ului

---

## 📱 FLOW COMPLET

### Ce se întâmplă când user deschide app:

```
1. App verifică versiune în Database
   ↓
2. Detectează: build 1 < 999
   ↓
3. Afișează dialog:
   "🎉 Versiune nouă disponibilă! Descarcă direct din Supabase."
   [Actualizează Acum]
   ↓
4. User apasă "Actualizează Acum"
   ↓
5. User e deconectat automat
   ↓
6. La redeschidere: dialog cu buton download
   ↓
7. User apasă "Actualizează Acum"
   ↓
8. Se deschide browser cu URL Supabase Storage
   ↓
9. Începe download APK (direct din Supabase!)
   ↓
10. User instalează APK manual
   ↓
11. User deschide app cu versiunea nouă
   ↓
12. User se loghează din nou
```

---

## 🔧 AVANTAJE SUPABASE STORAGE

### De ce Supabase Storage vs Play Store/Mail?

✅ **Control complet:**

- Tu decizi când e disponibil update-ul
- Poți șterge versiuni vechi
- Poți vedea câte download-uri

✅ **Rapid:**

- Fără aprobare Play Store (instant!)
- Fără așteptare review (ore/zile)
- Deploy imediat

✅ **Flexibil:**

- Poți avea multiple versiuni
- Poți face rollback instant
- Poți testa beta versions

✅ **Gratuit:**

- Supabase Storage: 5GB gratuit
- Bandwidth: 1GB/zi gratuit
- Suficient pentru 20-50 download-uri/zi

---

## 📊 STRUCTURA SUPABASE STORAGE

### Organizare recomandată:

```
📁 superparty-frontend.appspot.com
  └── 📁 apk
       ├── 📄 superparty-v1.0.0.apk (versiune veche)
       ├── 📄 superparty-v1.0.1.apk (versiune nouă)
       ├── 📄 superparty-v1.0.2-beta.apk (beta)
       └── 📄 superparty-latest.apk (link către ultima versiune)
```

### URL-uri:

```
Versiune 1.0.1:
https://supabasestorage.googleapis.com/v0/b/superparty-frontend.appspot.com/o/apk%2Fsuperparty-v1.0.1.apk?alt=media

Versiune latest (redirect):
https://supabasestorage.googleapis.com/v0/b/superparty-frontend.appspot.com/o/apk%2Fsuperparty-latest.apk?alt=media
```

---

## 🔐 SECURITATE

### Permisiuni recomandate:

**Storage Rules:**

```javascript
// APK-uri: public read, admin write
match /apk/{fileName} {
  allow read: if true;
  allow write: if request.auth != null &&
                  request.auth.token.email == 'ursache.andrei1995@gmail.com';
}
```

**Database Rules:**

```javascript
// Configurație versiune: public read, admin write
match /app_config/version {
  allow read: if true;
  allow write: if request.auth != null &&
                  request.auth.token.email == 'ursache.andrei1995@gmail.com';
}
```

---

## 📈 MONITORING

### Verifică download-uri în Supabase Console:

**Storage → Usage:**

- Total storage used
- Download bandwidth
- Number of operations

**Database → Usage:**

- Document reads (câte verificări de versiune)

---

## 🐛 TROUBLESHOOTING

### Problema: "Access Denied" la download

**Cauză:** Storage Rules nu permit public read

**Soluție:**

```javascript
match /apk/{fileName} {
  allow read: if true;  // ← Asigură-te că e true!
}
```

### Problema: URL-ul nu funcționează

**Cauză:** URL-ul e greșit sau fișierul nu există

**Verifică:**

1. Fișierul există în Storage
2. URL-ul conține `?alt=media` la final
3. Path-ul e corect: `apk%2Fsuperparty-v1.0.1.apk`

### Problema: Download-ul e lent

**Cauză:** Supabase Storage bandwidth limit

**Soluție:**

- Upgrade la Blaze plan (pay-as-you-go)
- Sau folosește CDN (Cloudflare, etc.)

---

## 💰 COSTURI

### Supabase Storage Pricing:

**Spark Plan (Gratuit):**

- Storage: 5 GB
- Download: 1 GB/zi
- Upload: 20,000/zi

**Blaze Plan (Pay-as-you-go):**

- Storage: $0.026/GB/lună
- Download: $0.12/GB
- Upload: $0.05/GB

**Exemplu:**

- APK size: 50 MB
- Download-uri: 100/lună
- Cost: 100 × 50 MB × $0.12/GB = **$0.60/lună**

---

## 🎯 NEXT STEPS

### După configurare:

1. ✅ Upload APK în Supabase Storage
2. ✅ Obține URL de download
3. ✅ Actualizează Database cu URL-ul
4. ✅ Setează Storage Rules (public read)
5. ✅ Testează download-ul în browser
6. ✅ Testează în app

### Pentru versiuni viitoare:

1. Build APK nou: `flutter build apk --release`
2. Upload în Supabase Storage: `apk/superparty-v1.0.2.apk`
3. Obține URL nou
4. Actualizează Database:
   ```javascript
   {
     "min_version": "1.0.2",
     "min_build_number": 2,
     "android_download_url": "https://supabasestorage.googleapis.com/.../v1.0.2.apk?alt=media"
   }
   ```
5. Userii vor primi update automat!

---

## ✅ CHECKLIST FINAL

- [ ] Documentul `app_config/version` creat în Database
- [ ] APK uploadat în Supabase Storage (`apk/` folder)
- [ ] URL de download copiat și pus în Database
- [ ] Storage Rules setate (public read pentru `apk/`)
- [ ] Testat download în browser (funcționează)
- [ ] Testat în app (dialog apare, download începe)

---

**Link-uri utile:**

- Database: https://console.supabase.google.com/project/superparty-frontend/database
- Storage: https://console.supabase.google.com/project/superparty-frontend/storage
- Storage Rules: https://console.supabase.google.com/project/superparty-frontend/storage/rules

**Status:** ✅ Gata de configurare  
**Timp estimat:** 10 minute  
**Dificultate:** Ușor
