/**
 * routes/health.mjs
 * GET /health — liveness check
 * GET /metrics — Prometheus metrics
 */

import { Router } from 'express';
import { collectDefaultMetrics, Registry, Gauge } from 'prom-client';

const router = Router();
const startTime = Date.now();

// Prometheus registry
const registry = new Registry();
collectDefaultMetrics({ register: registry });

// Custom gauge: analyze_event requests
export const analyzeEventCounter = new Gauge({
  name: 'ai_manager_analyze_event_total',
  help: 'Total AI analyze-event calls',
  labelNames: ['status'],
  registers: [registry],
});

// Custom gauge: active trips
export const activeTripsGauge = new Gauge({
  name: 'ai_manager_active_trips',
  help: 'Currently active employee trips',
  registers: [registry],
});

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'superparty-ai-manager',
    version: '1.0.0',
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
  });
});

router.get('/metrics', async (_req, res) => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});

export default router;
