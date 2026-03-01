# Firebase Route Diagnostics

This module identifies abandoned or broken webhook destinations and SIP PBX links stored in our Firestore collections (`routes`, `whatsapp_routes`, `pbx_routes`).

## Heuristics utilized:

- **Liveness Probes**: Heads/GET endpoints to establish health. Tests timeouts and TLS expiration.
- **Log Activity**: Scans Loki and Prometheus for real traffic matched to the `routeId`.
- **Code Reference**: Performs a `git grep` and GitHub Code Search to confirm code references.

If 0 usages are found in the last 30 days, the probe is failing, and no references exist, it is marked as `STALE`.

## Secrets Required

Set these environment variables inside GitHub Actions:

- `FIREBASE_SA` (Google Credentials block)
- `LOKI_URL` & `PROM_URL` (For backend usage insights)
- `SLACK_WEBHOOK_URL` (Alert notifications)
