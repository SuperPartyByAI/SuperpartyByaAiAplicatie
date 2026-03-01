# Infrastructure & Observability Audit Report

**Date:** $(date)

## 1. Inventory Status
| Component | Repo Definition | Server Runtime | Target Status |
| :--- | :--- | :--- | :--- |
| **Prometheus** | ✅ \`infra/docker-compose...\` | ✅ UP (Container: \`superparty-prometheus\`) | Ready |
| **Grafana** | ✅ \`infra/docker-compose...\` | ✅ UP (Container: \`superparty-grafana\`) | Ready |
| **Loki & Promtail** | ✅ \`infra/docker-compose...\` | ✅ UP (Container: \`superparty-loki\`) | Ready |
| **Caddy (Reverse Proxy)** | ✅ Check Caddyfile natively | ✅ UP (systemd active) | Ready |
| **VoIP Orchestrator** | ✅ PR #3 (\`voip_orch.py\`) | ❌ MISSING (\`voip_orch.service\` missing) | Needs Deploy |
| **Alertmanager** | ✅ PR #3 (\`alertmanager.yml\`) | ❌ MISSING in docker-compose runtime | Needs Deploy |

## 2. Server Verifications
- **Grafana Container Logs (Port 3333):** Accessible but Caddy refuses connection from external proxies for HTTP/3 TLS mismatched domains. Known bug, resolved directly via local IPv4 mappings.
- **Node Exporter:** Successfully binding to \`127.0.0.1:9100\`.

## 3. Playbooks and Missing Items Required
Deployments required for full synergy (Runbook):
1. **GitHub Secrets Missing:**
   - \`ADMIN_TOKEN\`
   - \`SLACK_WEBHOOK_URL\`
   - \`SUPABASE_SA\` (Service Account JSON text)
2. **Server Secrets:**
   - \`ORCH_SECRET\` on Node machine in \`/opt/voip-orch/.env\`
3. **Execution Instructions:**
   - Merge PR #3, #4, #5, #6.
   - SSH to the host and run \`docker-compose -f infra/docker-compose.observability.yml up -d\`
   - Copy \`infra/orchestrator/voip_orch.service\` to \`/etc/systemd/system/\` and \`systemctl enable --now voip_orch\`.

## 4. Final Verdict
- Observability (Data Storage & Visuals) is actively running in production and matching the new repo templates cleanly.
- Logic Remediation & Validation (Orchestrators) are fully coded, CI tested via Jest/Python Dry-runs and await Merge and secret bindings to take effect.
