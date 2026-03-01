# VoIP Remediation Orchestrator

This webhook orchestrator listens for Prometheus Alertmanager notifications and executes a safe auto-remediation playbook for VoIP call failures.

## Features

- Validates alerts via HMAC/Secret header (`ORCH_SECRET`).
- Enforces a lock/cooldown period (`COOLDOWN_SECONDS`) per alert to prevent restart loops.
- Supports `DRY_RUN=true` mode to safely log intended actions without taking them.
- Posts detailed audits to Slack (`SLACK_WEBHOOK_URL`).
- Restarts the backend service and runs a post-restart smoke-test verification.

## Prerequisites & Secrets

You must configure the following environment variables (e.g., in a Systemd drop-in or Secret Manager) before running:

- `ORCH_SECRET`: Secret string for webhook validation.
- `SLACK_WEBHOOK_URL`: Slack URL for alert notifications.
- `ADMIN_TOKEN`: Authentication token for executing the smoke test.
- `DOMAIN`: Domain of the backend (default: `https://api.superparty.ro`).
- `DRY_RUN`: Set to `false` only after staging verification.
- `COOLDOWN_SECONDS`: Minimum seconds between remediations for the same alert.

## Run Locally (Test)

```bash
pip install fastapi uvicorn
export ORCH_SECRET="test-secret"
export DRY_RUN="true"
uvicorn orchestrator:app --host 0.0.0.0 --port 8000
```
