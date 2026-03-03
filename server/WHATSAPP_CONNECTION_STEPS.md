# Pași pentru Conectarea WhatsApp prin QR Code

## Status Actual
- **Account ID**: `account_dev_dde908a65501c63b124cb94c627e551d`
- **Status**: `qr_ready` (QR code disponibil pentru scanare)
- **QR Code**: Generat și afișat în aplicație

---

## Pași pentru Conectare

### 1. În Aplicația Flutter
✅ Deschide: **WhatsApp → Manage Accounts**
✅ Vezi QR code-ul mare afișat pentru account
✅ Status ar trebui să fie: `qr_ready` sau `awaiting_scan`

### 2. Pe Telefonul Real (cu WhatsApp instalat)
✅ Deschide **WhatsApp** pe telefon
✅ Mergi la **Settings → Linked Devices** (Dispozitive conectate)
✅ Apasă **"Link a device"** (Conectează un dispozitiv)

### 3. Scanează QR Code-ul
✅ Ține ecranul telefonului **foarte aproape** de QR code-ul din aplicație
✅ WhatsApp va detecta automat QR code-ul
✅ Așteaptă confirmarea că s-a conectat

### 4. Verifică Status în Aplicație
✅ **Status ar trebui să devină: `connected`** (verde)
✅ QR code-ul dispare când status devine `connected`
✅ Aplicația va actualiza automat (polling `getAccounts()`)

---

## Ce Să Cauți (Success Indicators)

### ✅ Conectat cu Succes
- Status devine: **`connected`** (verde)
- QR code dispare
- Mesaj verde: "Account connected"
- Poți vedea conversații în **Inbox**

### ❌ Probleme Posibile

#### QR Code Expirat
- Status rămâne: `qr_ready` sau `awaiting_scan`
- **Soluție**: Apasă "Regenerate QR" și scanează din nou

#### Timeout (60s)
- Status devine: `disconnected`
- **Cauză**: QR code nu a fost scanat în 60 secunde
- **Soluție**: Regenerare QR și scanare rapidă

#### Backend PASSIVE Mode
- Status: `passive`
- **Cauză**: Backend nu are lock (multiple instanțe)
- **Soluție**: Așteaptă 30-60s și reîncearcă

---

## Verificare în Loguri

### Flutter Logs (Local)
```bash
tail -50 /tmp/flutter_live_logs.txt | grep -i "status.*connected\|Account:.*status"
```

**Expected după scanare:**
```
[WhatsAppAccountsScreen] Account: id=account_dev_xxx, status=connected, hasQR=false
```

### legacy hosting Backend Logs
Verifică în legacy hosting dashboard:
- `connection.update: open` - conexiune deschisă
- `connection.update: connect` - conectat cu succes
- Status în Database devine `connected`

---

## Troubleshooting

### QR Code nu se scanează
1. Verifică că QR code-ul este clar vizibil
2. Asigură-te că lumina este suficientă
3. Regenerare QR dacă a expirat (> 60s)
4. Verifică că telefonul are cameră funcțională

### Status rămâne `qr_ready`
1. Verifică că ai scanat QR code-ul corect
2. Verifică conectivitatea internet (telefon + backend)
3. Verifică legacy hosting logs pentru erori

### Status devine `disconnected`
1. Probabil timeout (QR nefolosit > 60s)
2. Regenerare QR și scanare rapidă
3. Verifică legacy hosting logs pentru detalii

---

## Comenzi Rapide

### Verificare Status Local
```bash
tail -50 /tmp/flutter_live_logs.txt | grep -i "Account:.*status"
```

### Verificare legacy hosting Logs
```
legacy hosting Dashboard → Deploy Logs → Căutare "connection.update"
```

### Verificare Database
```
Supabase Console → Database → Collection "accounts" → Document "account_dev_xxx"
→ Field "status" ar trebui să fie "connected"
```

---

## Rezumat

1. ✅ QR code este generat și afișat (`status=qr_ready`)
2. 📱 Scanează QR cu WhatsApp din telefon
3. ⏱️ Așteaptă 5-10 secunde pentru confirmare
4. ✅ Verifică status = `connected` în aplicație
5. 🎉 Account conectat! Poți folosi Inbox/Chat

**Timp estimat**: 10-30 secunde de la scanare la `connected`
