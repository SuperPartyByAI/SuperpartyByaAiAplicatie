# 🔑 Obținere Supabase ID Token din Browser

## Metoda 1: Din Browser Console (cel mai simplu)

1. **Deschide aplicația web** (SuperParty) în browser
2. **Autentifică-te** (dacă nu ești deja)
3. **Deschide Developer Tools** (F12 sau Cmd+Option+I pe Mac)
4. **Mergi la tab-ul Console**
5. **Rulează următoarea comandă**:

```javascript
// Dacă folosești Supabase v9+
import { getAuth } from 'supabase/auth';
const auth = getAuth();
auth.currentUser?.getIdToken().then(token => {
  console.log('ID Token:', token);
  navigator.clipboard.writeText(token).then(() => {
    console.log('✅ Token copiat în clipboard!');
  });
});

// SAU dacă folosești Supabase v8
supabase.auth().currentUser.getIdToken().then(token => {
  console.log('ID Token:', token);
  navigator.clipboard.writeText(token).then(() => {
    console.log('✅ Token copiat în clipboard!');
  });
});
```

6. **Token-ul va fi afișat în console și copiat automat**

## Metoda 2: Din Network Tab

1. **Deschide Developer Tools** (F12)
2. **Mergi la tab-ul Network**
3. **Filtrează după "XHR" sau "Fetch"**
4. **Fă o acțiune în aplicație** (ex: refresh, click pe ceva)
5. **Găsește un request către backend** (ex: `/api/whatsapp/...`)
6. **Click pe request → Headers**
7. **Caută header-ul "Authorization: Bearer ..."**
8. **Copiază token-ul după "Bearer "**

## Metoda 3: Din Application/Storage Tab

1. **Deschide Developer Tools** (F12)
2. **Mergi la tab-ul Application** (Chrome) sau **Storage** (Firefox)
3. **În stânga, caută "Local Storage" sau "Session Storage"**
4. **Selectează domeniul aplicației**
5. **Caută chei care conțin "token", "auth", "supabase"**
6. **Copiază valoarea token-ului**
