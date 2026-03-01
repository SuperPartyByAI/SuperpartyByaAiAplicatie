# Monitoring & Void Remediation Playbooks

This directory contains configuration files for establishing a self-healing Voice IP (VoIP) architecture:

1. **Prometheus Rules (`prometheus/voip.rules.yml`)**: Evaluates `voip_call_failures_total` metrics to detect anomalies or complete outages.
2. **Alertmanager Config (`alertmanager/alertmanager.yml`)**: Routes critical and warning alerts to our webhook orchestrator and Slack.

## Loading the Configuration

To load the Prometheus rules, map the `voip.rules.yml` path in your `prometheus.yml` under `rule_files:`. Reload Prometheus (e.g., `kill -SIGHUP <pid>`).

To load Alertmanager config, pass it to your Alertmanager startup command.

## Expected Alerts

- **VoIPCallFailureHigh**: Sustained failure rate (critical). Triggers automated PM2 restart of backend.
- **VoIPCallFailureSpike**: Short-term burst in failures (warning). Informational track only by default.
