# Observabilitate — Loki + Prometheus + Grafana

## Arhitectură

```
Backend Node → (pino JSON logs) → Promtail → Loki → Grafana
Backend Node → (/metrics) → Prometheus → Grafana
Server → node-exporter → Prometheus → Grafana
Caddy → (access.log JSON) → Promtail → Loki → Grafana
```

Toate serviciile rulează în Docker Compose, accesibile **doar pe localhost**.
Grafana este expus prin Caddy cu **basic auth**.

---

## Setup

```bash
cd /opt/superparty/infra
docker compose -f docker-compose.observability.yml up -d
```

## Accesare Grafana

- **URL**: `https://api.superparty.ro/grafana/`
- **User**: `admin`
- **Parola**: din variabila `GRAFANA_ADMIN_PASSWORD` (`.env`)

## Dashboard-uri

### SuperParty — Overview

Dashboard auto-provizionat cu:

- CPU / RAM / Disk usage (gauge + timeseries)
- HTTP Request Rate (total + 5xx)
- HTTP Latency P95 / P50
- Service Up/Down indicator
- HTTP Status Code Distribution (pie chart)
- Backend Logs (Loki live tail)

## Alerte configurate

| Alertă            | Condiție                    | Severitate |
| ----------------- | --------------------------- | ---------- |
| High CPU          | CPU > 85% for 5m            | warning    |
| High Memory       | RAM > 85% for 5m            | warning    |
| High Disk         | Disk > 80% for 5m           | critical   |
| High 5xx Rate     | 5xx > 5% of total for 2m    | critical   |
| High Latency P95  | P95 > 2s for 5m             | warning    |
| Backend Down      | /metrics unreachable for 1m | critical   |
| SSL Cert Expiring | < 7 days                    | critical   |

## Query-uri utile Loki

```
# Toate logurile backend
{service="superparty-backend"} | json

# Caută un requestId specific
{service="superparty-backend"} |= "abc123-uuid"

# Doar erori
{service="superparty-backend"} | json | level="error"

# Request-uri lente (> 1000ms)
{service="superparty-backend"} | json | duration > 1000
```

## Troubleshooting

```bash
# Status componente
docker compose -f docker-compose.observability.yml ps

# Logs Grafana
docker logs superparty-grafana --tail 50

# Verifică Prometheus targets
curl http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | {job: .labels.job, health: .health}'

# Verifică Loki health
curl http://localhost:3100/ready

# Restart stack
docker compose -f docker-compose.observability.yml restart
```
