# Setup GROQ API Key pentru Auto-Reply

## Cheia API Groq

```
gsk_YOUR_GROQ_API_KEY_HERE
```

## Cum se Configurează

### Pe Hetzner (Production)

Backend-ul rulează pe Hetzner. Cheia trebuie setată în fișierul de environment:

```bash
# Conectează-te la serverul Hetzner
ssh user@37.27.34.179

# Editează fișierul de environment
sudo nano /etc/whatsapp-backend/supabase-sa.env

# Adaugă linia:
GROQ_API_KEY=gsk_YOUR_GROQ_API_KEY_HERE

# Salvează și ieși (Ctrl+X, apoi Y, apoi Enter)

# Repornește serviciul
sudo systemctl restart whatsapp-backend

# Verifică statusul
sudo systemctl status whatsapp-backend --no-pager

# Verifică logs pentru a vedea dacă cheia este recunoscută
sudo journalctl -u whatsapp-backend -f
```

### Verificare

După restart, verifică în logs că nu apare eroarea:
```
GROQ_API_KEY not configured
```

Dacă vezi în logs:
```
🤖 [ai-autoreply] account=... thread=... replyLen=... latencyMs=...
```

Înseamnă că auto-reply-ul funcționează!

## Structura Fișierului `/etc/whatsapp-backend/supabase-sa.env`

Fișierul ar trebui să conțină:

```bash
# Supabase Service Account
SUPABASE_PRIVATE_KEY=...
SUPABASE_CLIENT_EMAIL=...

# Groq API Key pentru AI Auto-Reply
GROQ_API_KEY=gsk_YOUR_GROQ_API_KEY_HERE

# Admin emails (opțional)
ADMIN_EMAILS=admin1@example.com,admin2@example.com

# AI Default Prompt (opțional)
AI_DEFAULT_SYSTEM_PROMPT="Ești un asistent WhatsApp. Răspunzi politicos, scurt și clar în română."
```

## Notă de Securitate

⚠️ **NU** comite această cheie în Git! Este deja setată în environment variables pe server.

## Testare

După configurare:

1. Deschide Flutter app → WhatsApp → Inbox
2. Selectează un cont WhatsApp
3. Activează "AI Auto‑Reply" switch
4. Setează un prompt (ex: "Răspunde politicos în română")
5. Trimite un mesaj la numărul WhatsApp conectat
6. Ar trebui să primești un răspuns automat generat de AI

## Troubleshooting

### Auto-reply nu funcționează

1. Verifică că `GROQ_API_KEY` este setat:
   ```bash
   sudo cat /etc/whatsapp-backend/supabase-sa.env | grep GROQ
   ```

2. Verifică că serviciul a fost repornit:
   ```bash
   sudo systemctl status whatsapp-backend
   ```

3. Verifică logs pentru erori:
   ```bash
   sudo journalctl -u whatsapp-backend -n 100 --no-pager
   ```

4. Verifică că `autoReplyEnabled` este `true` în Database:
   - Deschide Supabase Console
   - Verifică `accounts/{accountId}` → `autoReplyEnabled` = `true`

### Eroare: "GROQ_API_KEY not configured"

- Verifică că cheia este în `/etc/whatsapp-backend/supabase-sa.env`
- Verifică că nu există spații în jurul `=`
- Repornește serviciul după modificare
