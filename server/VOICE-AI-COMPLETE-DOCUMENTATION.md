# 🎤 Voice AI - Documentație Completă

## Status: ✅ FUNCȚIONAL

Data: 28 Decembrie 2025

---

## 📋 Ce am realizat

### 1. Voice AI Backend

- **Repository**: `SuperPartyByAI/superparty-ai-backend`
- **Branch**: `main`
- **Tehnologii**:
  - Node.js + Express
  - OpenAI GPT-4o (conversație AI)
  - Google Cloud Text-to-Speech (voce naturală)
  - Twilio (telefonie)

### 2. Deployment legacy hosting

- **Service URL**: `https://whats-app-ompro.ro`
- **Service ID**: `1931479e-da65-4d3a-8c5b-77c4b8fb3e31`
- **Project ID**: `a08232e9-9a0b-4bab-b7bd-7efaa7c83868`

### 3. Twilio Configuration

- **Număr telefon**: `+1 (218) 220-4425`
- **Webhook**: `https://whats-app-ompro.ro/api/voice/incoming`
- **Status**: Auto-configurat prin API

---

## 🔧 Configurare legacy hosting Variables

### Variables Complete (Copy-Paste în Raw Editor):

```
LEGACY_TOKEN=998d4e46-c67c-47e2-9eaa-ae4cc806aab1
PORT=3001
NODE_ENV=production
SUPERPARTY_PROJECT_ID=6d417631-9c08-479c-aa97-d898dd0d5b03
VOICE_PROJECT_ID=1931479e-da65-4d3a-8c5b-77c4b8fb3e31
PROJECT_NAME_1=SuperParty Backend
BACKEND_URL_1=https://whats-app-ompro.ro
BACKEND_SERVICE_ID_1=6d417631-9c08-479c-aa97-d898dd0d5b03
COQUI_URL_1=https://whats-app-ompro.ro
COQUI_SERVICE_ID_1=6d417631-9c08-479c-aa97-d898dd0d5b03
PROJECT_NAME_2=Web Production
BACKEND_URL_2=https://whats-app-ompro.ro
BACKEND_SERVICE_ID_2=1931479e-da65-4d3a-8c5b-77c4b8fb3e31
COQUI_URL_2=https://whats-app-ompro.ro
COQUI_SERVICE_ID_2=1931479e-da65-4d3a-8c5b-77c4b8fb3e31
OPENAI_API_KEY=<INSERT_OPENAI_KEY>
TWILIO_ACCOUNT_SID=[REDACTED_TWILIO]
TWILIO_AUTH_TOKEN=5c6670d39a1dbf46d47ecdaa244b91d9
TWILIO_PHONE_NUMBER=+12182204425
BACKEND_URL=https://whats-app-ompro.ro
COQUI_API_URL=https://whats-app-ompro.ro
GOOGLE_CREDENTIALS_JSON=[REDACTED]
```

---

## 📁 Structura Cod

### Repository: `superparty-ai-backend`

```
superparty-ai-backend/
├── server.js                    # Express server principal
├── voice-ai-handler.js          # GPT-4o conversation logic
├── twilio-handler.js            # Twilio call handling
├── google-tts-handler.js        # Google Cloud TTS (voce naturală)
├── elevenlabs-handler.js        # ElevenLabs (backup, nu folosit)
├── coqui-handler.js             # Coqui XTTS (backup, nu folosit)
├── package.json                 # Dependencies
├── Procfile                     # legacy hosting start command
└── legacy hosting.json                 # legacy hosting configuration
```

### Fișiere Importante în `Aplicatie-SuperpartyByAi`:

```
legacy hosting-monitor/
├── configure-twilio.js          # Auto-configure Twilio webhooks
├── verify-and-fix.js            # Verify deployment status
├── legacy hosting-api-complete.js      # legacy hosting API automation
└── update-twilio-webhook.js     # Update Twilio webhook URL

voice-backend/                   # Original voice backend code
VOICE-AI-COMPLETE-DOCUMENTATION.md  # Acest fișier
```

---

## 🎯 Cum Funcționează

### Flow Apel Telefonic:

1. **User sună** la `+1 (218) 220-4425`
2. **Twilio** primește apelul
3. **Webhook** trimite la: `https://whats-app-ompro.ro/api/voice/incoming`
4. **Backend** răspunde cu salut: "Bună ziua! Numele meu este Kasya, de la SuperParty. Cu ce vă pot ajuta?"
5. **User vorbește** (4 secunde timeout pentru speech)
6. **GPT-4o** procesează conversația
7. **Google TTS** generează răspuns audio (voce naturală)
8. **Twilio** redă audio-ul către user
9. **Repeat** până la finalizare

### Voce:

- **Provider**: Google Cloud Text-to-Speech
- **Voice**: `ro-RO-Wavenet-A` (Female, natural)
- **Settings**:
  - Speaking rate: 0.95 (mai lent)
  - Pitch: +2.0 (mai feminin)
  - Profile: telephony-class-application
- **Fallback**: Amazon Polly Carmen (dacă Google nu e disponibil)

---

## 🔧 Scripts Utile

### 1. Verificare Status

```bash
node legacy hosting-monitor/verify-and-fix.js
```

### 2. Configurare Twilio Webhook

```bash
node legacy hosting-monitor/configure-twilio.js
```

### 3. Test Backend

```bash
curl https://whats-app-ompro.ro/
```

---

## 🐛 Troubleshooting

### Problema: Vocea e robotizată

**Cauză**: Google TTS nu e configurat sau credentials lipsesc
**Soluție**: Verifică că `GOOGLE_CREDENTIALS_JSON` e setat în legacy hosting Variables

### Problema: "Nu am primit nicio informație"

**Cauză**: Timeout prea scurt sau Twilio nu primește speech
**Soluție**:

- Verifică că `speechTimeout: 4` și `timeout: 6` în `twilio-handler.js`
- Vorbește mai tare/clar

### Problema: Apelul se închide instant

**Cauză**: Backend nu răspunde sau webhook greșit
**Soluție**:

- Verifică legacy hosting logs
- Verifică că webhook-ul Twilio e corect setat
- Rulează: `node legacy hosting-monitor/configure-twilio.js`

### Problema: Backend-ul vechi încă rulează

**Cauză**: legacy hosting nu a luat repo-ul nou
**Soluție**:

1. legacy hosting → Settings → Source → Disconnect
2. Connect Repo → `SuperPartyByAI/superparty-ai-backend` (branch: main)
3. Verifică că în logs apare: `SuperParty Backend - WhatsApp + Voice`

---

## 📊 Monitoring

### v7.0 Monitor

- **URL**: `https://whats-app-ompro.ro`
- **Dashboard**: Multi-project monitoring
- **Features**:
  - Self-monitoring
  - Auto-repair
  - Health checks
  - Uptime tracking

### legacy hosting Logs

```
[GoogleTTS] Initialized
[VoiceAI] Initialized with OpenAI
[Twilio] Incoming call: { callSid: '...', from: '...' }
[GoogleTTS] Generating speech...
[GoogleTTS] Speech generated and cached
```

---

## 💰 Costuri

### Google Cloud TTS

- **Free Tier**: 1 milion caractere/lună (WaveNet)
- **Cost după**: $16/1M caractere
- **Estimat**: ~$0-5/lună (usage normal)

### OpenAI GPT-4o

- **Cost**: $2.50/1M input tokens, $10/1M output tokens
- **Estimat**: ~$10-20/lună (100-200 apeluri/zi)

### Twilio

- **Cost**: $0.0085/minut (incoming calls)
- **Estimat**: Depinde de volum

### legacy hosting

- **Plan**: Hobby ($5/lună) sau Pro ($20/lună)
- **Inclus**: Compute, bandwidth, storage

**Total estimat**: $15-50/lună

---

## 🚀 Next Steps

### Îmbunătățiri Posibile:

1. **Voce Clonată Kasya**
   - Upload sample audio în ElevenLabs
   - Clone voice
   - Replace Google TTS cu ElevenLabs

2. **Optimizare Conversație**
   - Fine-tune GPT-4o prompt
   - Add more context despre pachete
   - Improve error handling

3. **Analytics**
   - Track call duration
   - Conversion rate
   - Common questions

4. **Integrare CRM**
   - Save reservations în database
   - Send email confirmations
   - WhatsApp notifications

---

## 📞 Contact & Support

- **Repository**: https://github.com/SuperPartyByAI/superparty-ai-backend
- **legacy hosting Project**: https://legacy hosting.app/project/a08232e9-9a0b-4bab-b7bd-7efaa7c83868
- **Twilio Console**: https://console.twilio.com/

---

## ✅ Checklist Deployment

- [x] Backend code pushed to GitHub
- [x] legacy hosting service connected to correct repo
- [x] All environment variables set
- [x] Google Cloud credentials configured
- [x] Twilio webhook configured
- [x] Voice AI tested and working
- [ ] Voice quality optimized (în progres)
- [ ] Production testing complete

---

**Ultima actualizare**: 28 Decembrie 2025, 12:00 PM
**Status**: ✅ Funcțional, în curs de optimizare voce
