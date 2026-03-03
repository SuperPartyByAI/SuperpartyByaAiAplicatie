# Activate Auto-Reply - Quick Guide

## ✅ Status Actual

- **Backend**: Codul auto-reply este implementat și deployat
- **GROQ_API_KEY**: Setat (`gsk_YOUR_GROQ_API_KEY_HERE`)
- **Server**: Restartat cu codul nou

## 🔧 Cum Activezi Auto-Reply

### Opțiunea 1: Flutter App (Recomandat)

1. **Deschide Flutter app** pe iPhone
2. **Navighează la WhatsApp Inbox**
3. **Apasă pe Settings** (iconița de setări în header)
4. **Activează "Auto-Reply Toggle"** (ON)
5. **Configurează prompt-ul** (opțional):
   - Apasă pe "AI Settings" sau "Configure Prompt"
   - Introdu prompt-ul: `Ești un asistent WhatsApp. Răspunzi politicos, scurt și clar în română. Nu inventezi informații. Dacă nu știi ceva, spui clar că nu știi.`
   - Salvează

### Opțiunea 2: Database Console (Direct)

1. **Deschide Supabase Console**: https://console.supabase.google.com/project/superparty-frontend/database
2. **Navighează la**: `accounts` → `account_prod_26ec0bfb54a6ab88cc3cd7aba6a9a443`
3. **Editează documentul**:
   - `autoReplyEnabled`: `true`
   - `autoReplyPrompt`: `Ești un asistent WhatsApp. Răspunzi politicos, scurt și clar în română. Nu inventezi informații. Dacă nu știi ceva, spui clar că nu știi.`
4. **Salvează**

## 🧪 Testare

1. **Activează auto-reply** (folosind una din opțiunile de mai sus)
2. **Trimite un mesaj de test** la numărul WhatsApp conectat
3. **Monitorizează logs**:
   ```bash
   ssh -i ~/.ssh/hetzner_whatsapp root@37.27.34.179 "sudo journalctl -u whatsapp-backend -f --no-pager" | grep -E "AutoReply|🤖"
   ```
4. **Verifică în Flutter app**:
   - Deschide conversația
   - Ar trebui să vezi răspunsul automat în 5-10 secunde

## 📊 Logs de Așteptat

Când auto-reply funcționează, vei vedea:

```
[AutoReply] 📱 Sending FCM notification: account=... msg=...
[AutoReply] ✅ FCM sent successfully
[AutoReply] 🚀 Triggering auto-reply: account=... msg=... thread=... eventType=notify
[AutoReply] 🔍 Entry: account=... msg=... saved=true eventType=notify
[AutoReply] 🔍 Settings check: accountEnabled=true threadEnabled=false isAiEnabled=true
[AutoReply] 🤖 Calling Groq API: historyLength=... promptLength=...
[AutoReply] 📤 Sending reply: account=... to=... replyLen=...
🤖 [AutoReply] ✅ SUCCESS: account=... thread=... replyLen=... aiLatency=...ms totalLatency=...ms
```

## ⚠️ Troubleshooting

### Nu vezi logs de AutoReply

1. **Verifică că serverul rulează codul nou**:
   ```bash
   ssh -i ~/.ssh/hetzner_whatsapp root@37.27.34.179 "grep -n 'AutoReply.*📱' /opt/whatsapp/whatsapp-backend/server.js"
   ```
   Ar trebui să vezi: `862:              console.log(\`[AutoReply] 📱 Sending FCM notification...`

2. **Verifică că autoReplyEnabled este true**:
   - În Flutter app: Settings → Auto-Reply Toggle ON
   - Sau în Database: `accounts/{accountId}.autoReplyEnabled = true`

3. **Verifică că promptul este setat**:
   - În Flutter app: AI Settings → Prompt setat
   - Sau în Database: `accounts/{accountId}.autoReplyPrompt = "..."`

### Vezi "Gate X FAIL" în logs

- **Gate 8 FAIL**: Auto-reply nu este enabled → Activează în Flutter/Database
- **Gate 10/11 FAIL**: Cooldown activ → Așteaptă 10 secunde
- **Gate 12 FAIL**: GROQ_API_KEY nu este setat → Verifică `/etc/whatsapp-backend/groq-api-key.env`

## 🎯 Quick Command pentru Monitoring

```bash
# Monitorizează AutoReply logs în timp real
ssh -i ~/.ssh/hetzner_whatsapp root@37.27.34.179 "sudo journalctl -u whatsapp-backend -f --no-pager" | grep -E "AutoReply|🤖"

# Verifică ultimele mesaje procesate
ssh -i ~/.ssh/hetzner_whatsapp root@37.27.34.179 "sudo journalctl -u whatsapp-backend --since '5 minutes ago' --no-pager" | grep -E "messages.upsert|Message saved|AutoReply"
```
