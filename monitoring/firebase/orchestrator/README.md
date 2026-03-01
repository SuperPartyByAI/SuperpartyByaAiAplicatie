# Firebase Structure Checks Orchestrator

This directory contains the pipeline to automatically test, verify, and validate our Firebase setup (Firestore schema, security rules, indexes, and backups).

## Requirements

The orchestrator and integration checks expect the following environment variables:

- `PROJECT_ID`: e.g. `superparty-frontend`
- `BACKUP_BUCKET`: e.g. `gs://superparty-frontend-backups`
- `DRY_RUN`: "true" or "false"
- `GOOGLE_APPLICATION_CREDENTIALS`: Absolute path to the Firebase Service Account JSON file. Required for `admin_checks` to manipulate/clean test documents bypassing security rules.

## Local Execution (Dry Run)

```bash
cd monitoring/firebase/checks
export DRY_RUN="true"
export PROJECT_ID="superparty-frontend"
export BACKUP_BUCKET="gs://superparty-frontend-backups"

# To run tests via emulator, install requirements:
(cd tests && npm install)

# Run the python checks
python run_checks.py
```

## Interpreting Output

A Markdown report to `/tmp/report_firebase_structure.md` is generated detailing each phase (emulator, integration, backup).

- ✅ **OK**: Feature behaving securely and as defined.
- ❌ **CRITICAL**: Regression detected. Client escalated permissions or backup bucket inaccessible.
