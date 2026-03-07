/**
 * index.mjs — Superparty AI Manager entrypoint
 *
 * Starts Express server with:
 * - Auth middleware (Bearer token)
 * - Structured logging (pino-http)
 * - Health + Metrics (no auth)
 * - AI analyze-event
 * - GPS trips
 * - Contestations
 * - Media batch jobs
 * - BullMQ analysis worker
 */

import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import pino from 'pino';
import { config, isProd } from './config/config.mjs';

// ── Logger ────────────────────────────────────────────────────────────────────
export const logger = pino({
  level: config.log.level,
  ...(isProd ? {} : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
});

// ── Routes ────────────────────────────────────────────────────────────────────
import healthRouter from './routes/health.mjs';
import analyzeRouter from './routes/analyze.mjs';
import tripsRouter from './routes/trips.mjs';
import contestationsRouter from './routes/contestations.mjs';
import mediaRouter from './routes/media.mjs';
import logisticsRouter from './routes/logistics.mjs';

// ── Worker ────────────────────────────────────────────────────────────────────
import { initAnalysisWorker } from './workers/analysis-worker.mjs';

// ── App ───────────────────────────────────────────────────────────────────────
const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(pinoHttp({ logger }));

// Public routes (no auth)
app.use('/', healthRouter);

// Auth middleware — all routes below require Bearer token
app.use((req, res, next) => {
  const auth = req.headers['authorization'] ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || token !== config.adminToken) {
    return res.status(401).json({ error: 'Unauthorized — provide Authorization: Bearer <AI_ADMIN_TOKEN>' });
  }
  next();
});

// Protected routes
app.use('/ai', analyzeRouter);
app.use('/trips', tripsRouter);
app.use('/contestations', contestationsRouter);
app.use('/media', mediaRouter);
app.use('/logistics', logisticsRouter);

// 404 fallback
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
app.use((err, req, res, _next) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function main() {
  try {
    // Initialize BullMQ worker
    initAnalysisWorker(logger);

    app.listen(config.port, () => {
      logger.info(
        { port: config.port, env: config.nodeEnv, model: config.openai.model },
        '🤖 Superparty AI Manager started'
      );
    });
  } catch (err) {
    logger.error({ err }, 'Fatal startup error');
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

main();
