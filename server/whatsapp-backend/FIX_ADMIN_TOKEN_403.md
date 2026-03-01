# Reparare 403 „Invalid admin token” la sync-contacts-to-threads

Backend-ul compară tokenul din header (`Authorization: Bearer <token>`) cu `process.env.ADMIN_TOKEN`. Dacă nu sunt identice → 403.

## Reparare rapidă (serverul tău = Hetzner 37.27.34.179)

### 1. Setează un token cunoscut pe server

Conectează-te la server și configurează `ADMIN_TOKEN` la o valoare fixă, apoi repornește serviciul.

```bash
ssh root@37.27.34.179
```

Apoi, pe server:

**A) Dacă folosești systemd și env-ul e în unit / override:**

```bash
# Generează un token nou (copiază output-ul)
openssl rand -hex 32

# Creează override pentru serviciu (dacă nu există)
mkdir -p /etc/systemd/system/whatsapp-backend.service.d
cat > /etc/systemd/system/whatsapp-backend.service.d/admin-token.conf << 'EOF'
[Service]
Environment="ADMIN_TOKEN=PASTE_AICI_TOKENUL_GENERAT_MAI_SUS"
EOF

# Reîncarcă și repornește
systemctl daemon-reload
systemctl restart whatsapp-backend
```

**B) Dacă env-ul e într-un fișier (ex. `/opt/whatsapp-backend/.env`):**

```bash
# Adaugă sau modifică linia ADMIN_TOKEN în fișierul folosit la pornire
echo 'ADMIN_TOKEN=PASTE_AICI_TOKENUL_GENERAT' >> /opt/whatsapp-backend/.env
# Apoi repornește serviciul (ex. systemctl restart whatsapp-backend)
systemctl restart whatsapp-backend
```

Înlocuiește `PASTE_AICI_TOKENUL_GENERAT` cu output-ul de la `openssl rand -hex 32`.

### 2. Folosește același token la apel

Pe Mac, în același terminal:

```bash
cd /Users/universparty/Aplicatie-SuperpartyByAi
export ADMIN_TOKEN='acelasi_token_ca_pe_server'
node whatsapp-backend/scripts/call-sync-endpoint.js http://37.27.34.179:8080 "$ADMIN_TOKEN" "account_prod_26ec0bfb54a6ab88cc3cd7aba6a9a443" --dry-run
```

Dacă backend-ul afișează la pornire `🔐 ADMIN_TOKEN configured: xxxxxxxxxx...`, primele 10 caractere trebuie să coincidă cu primele 10 caractere ale tokenului pe care îl trimiți.

---

## Verificare rapidă pe server

Pe server, după restart:

```bash
# Ce token „vede” serviciul (primele 10 caractere)
systemctl show whatsapp-backend -p Environment | tr ' ' '\n' | grep ADMIN_TOKEN
```

Același string trebuie folosit ca `<adminToken>` în `call-sync-endpoint.js`.

---

## Alternativă: fără reparație la endpoint

Poți continua să rulezi **doar scriptul direct** (nu trebuie admin token):

```bash
node whatsapp-backend/scripts/sync-contacts-to-threads.js account_prod_26ec0bfb54a6ab88cc3cd7aba6a9a443
```

Scriptul scrie direct în Database; nu apelează backend-ul.
