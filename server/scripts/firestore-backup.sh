#!/usr/bin/env bash
# SuperParty — Firestore Backup Script
# Export Firestore zilnic în Cloud Storage bucket
#
# PREREQ:
#   gcloud auth login
#   gcloud config set project superparty-frontend
#   
# SETUP BUCKET (o singură dată):
#   gsutil mb -l europe-west1 gs://superparty-frontend-backups
#   gsutil lifecycle set lifecycle.json gs://superparty-frontend-backups
#
# LIFECYCLE.JSON (retenție 30 zile):
#   {
#     "rule": [{
#       "action": {"type": "Delete"},
#       "condition": {"age": 30}
#     }]
#   }
#
# CRON (pe server sau Cloud Scheduler):
#   0 2 * * * /opt/superparty/scripts/firestore-backup.sh >> /var/log/firestore-backup.log 2>&1
#
# SAU Cloud Scheduler (GCP Console):
#   gcloud scheduler jobs create http firestore-daily-backup \
#     --schedule="0 2 * * *" \
#     --uri="https://firestore.googleapis.com/v1/projects/superparty-frontend/databases/(default)/exportDocuments" \
#     --http-method=POST \
#     --message-body='{"outputUriPrefix":"gs://superparty-frontend-backups/'$(date +%Y-%m-%d)'"}' \
#     --oauth-service-account-email=your-service-account@superparty-frontend.iam.gserviceaccount.com \
#     --time-zone="Europe/Bucharest"

set -euo pipefail

PROJECT="superparty-frontend"
BUCKET="gs://${PROJECT}-backups"
DATE=$(date +%Y-%m-%d_%H%M)
EXPORT_PATH="${BUCKET}/${DATE}"

echo "=== Firestore Backup ==="
echo "Project: ${PROJECT}"
echo "Destination: ${EXPORT_PATH}"
echo "Date: $(date)"
echo ""

# Run export
gcloud firestore export "${EXPORT_PATH}" \
  --project="${PROJECT}" \
  --async

echo ""
echo "✅ Export started: ${EXPORT_PATH}"
echo "Check status: gcloud firestore operations list --project=${PROJECT}"
echo ""

# Optional: Clean up old backups (if lifecycle rule not set)
# gsutil -m rm -r "${BUCKET}/$(date -d '-31 days' +%Y-%m-%d_*)" 2>/dev/null || true
