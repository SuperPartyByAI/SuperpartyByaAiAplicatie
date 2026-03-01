#!/bin/bash
# backup auth_info logic
TIMESTAMP=$(date -u +"%Y-%m-%dT%H%MZ")
mkdir -p /backups
tar -czf /backups/auth_info_${TIMESTAMP}.tgz /root/whatsapp-integration-v6/auth_info

# Optional GS bucket handling
# gsutil cp /backups/auth_info_${TIMESTAMP}.tgz gs://your-bucket/wa-backups/
# gcloud firestore export gs://your-bucket/firestore-backups/$TIMESTAMP --project your-project-id

# Keep only last 14 backups
find /backups -name "auth_info_*.tgz" -mtime +14 -exec rm {} \;
