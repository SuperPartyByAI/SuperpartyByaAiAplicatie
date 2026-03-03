# Database Backup — Setup & Restore

## Configurare

### 1. Creează bucket

```bash
gsutil mb -l europe-west1 gs://superparty-frontend-backups
```

### 2. Lifecycle rule (retenție 30 zile)

```bash
cat > /tmp/lifecycle.json << 'EOF'
{
  "rule": [{
    "action": {"type": "Delete"},
    "condition": {"age": 30}
  }]
}
EOF

gsutil lifecycle set /tmp/lifecycle.json gs://superparty-frontend-backups
```

### 3. Setup cron pe server

```bash
# Adaugă în crontab (rulează zilnic la 02:00)
sudo crontab -e
# Adaugă linia:
0 2 * * * /opt/superparty/scripts/database-backup.sh >> /var/log/database-backup.log 2>&1
```

### 4. SAU Cloud Scheduler (GCP Console)

```bash
gcloud scheduler jobs create http database-daily-backup \
  --schedule="0 2 * * *" \
  --uri="https://database.googleapis.com/v1/projects/superparty-frontend/databases/(default)/exportDocuments" \
  --http-method=POST \
  --message-body='{"outputUriPrefix":"gs://superparty-frontend-backups/daily"}' \
  --oauth-service-account-email=supabase-adminsdk-xxxxx@superparty-frontend.iam.gserviceaccount.com \
  --time-zone="Europe/Bucharest" \
  --location=europe-west1
```

---

## Restore

### 1. Listează backup-urile disponibile

```bash
gsutil ls gs://superparty-frontend-backups/
```

### 2. Restore din backup

```bash
gcloud database import gs://superparty-frontend-backups/2026-02-26_0200 \
  --project=superparty-frontend
```

### 3. Verifică status

```bash
gcloud database operations list --project=superparty-frontend
```

---

## TODO (Necesită acțiuni manuale)

- [ ] Creează bucket `gs://superparty-frontend-backups`
- [ ] Setează lifecycle rule 30 zile
- [ ] Configurează Cloud Scheduler SAU cron pe server
- [ ] Verifică IAM permissions: service account necesită `roles/datastore.importExportAdmin` + write pe bucket
- [ ] Testează un export manual: `bash scripts/database-backup.sh`
