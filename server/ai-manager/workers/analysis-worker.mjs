/**
 * workers/analysis-worker.mjs
 * BullMQ worker for batch video/image analysis jobs.
 * Processes jobs asynchronously — no realtime requirement.
 */

import { Queue, Worker } from 'bullmq';
import { config } from '../config/config.mjs';
import { updateRow } from '../services/supabase.mjs';

const QUEUE_NAME = 'ai-analysis-jobs';

let queue = null;
let worker = null;

/**
 * Initialize queue and worker.
 * Called once from index.mjs.
 */
export function initAnalysisWorker(logger) {
  const connection = { url: config.redis.url };

  queue = new Queue(QUEUE_NAME, { connection });

  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { jobId, mediaAssetId, jobType } = job.data;
      logger?.info({ jobId, mediaAssetId, jobType }, '[analysis-worker] Processing job');

      // Mark job as running
      await updateRow('analysis_jobs', jobId, {
        status: 'running',
        started_at: new Date().toISOString(),
      });

      // TODO Phase 2: Integrate Google Vision / OpenAI Vision / FFmpeg here
      // For now: stub result with placeholder
      const stubResult = {
        stub: true,
        message: 'Vision analysis not yet implemented. Phase 2 task.',
        job_type: jobType,
        media_asset_id: mediaAssetId,
        analyzed_at: new Date().toISOString(),
      };

      await updateRow('analysis_jobs', jobId, {
        status: 'done',
        result_json: stubResult,
        confidence: 0,
        evidence_tags: [],
        completed_at: new Date().toISOString(),
      });

      logger?.info({ jobId }, '[analysis-worker] Job completed (stub)');
    },
    {
      connection,
      concurrency: config.analysis.concurrency,
    }
  );

  worker.on('failed', async (job, err) => {
    logger?.error({ jobId: job?.data?.jobId, err }, '[analysis-worker] Job failed');
    if (job?.data?.jobId) {
      await updateRow('analysis_jobs', job.data.jobId, {
        status: 'failed',
        error: err.message,
        completed_at: new Date().toISOString(),
      }).catch(() => {});
    }
  });

  logger?.info('[analysis-worker] Initialized');
  return { queue, worker };
}

/**
 * Enqueue a new analysis job.
 * Must be called after initAnalysisWorker().
 */
export async function enqueueAnalysisJob({ jobId, mediaAssetId, jobType }) {
  if (!queue) throw new Error('[analysis-worker] Queue not initialized. Call initAnalysisWorker() first.');
  await queue.add('analyze', { jobId, mediaAssetId, jobType }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  });
}

export function getWorkerStatus() {
  return {
    queue_name: QUEUE_NAME,
    worker_running: !!worker,
  };
}
