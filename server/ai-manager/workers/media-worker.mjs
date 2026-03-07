import { Worker } from 'bullmq';
import { supabase } from '../services/supabase.mjs';
import { analyzeImageWithAI, extractVideoFrames } from './media-handlers.mjs';

const QUEUE_NAME = 'media-analysis-queue';

export function initMediaWorker(logger, redisConfig) {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { assetId, sourceUrl, sourceType, eventId, bundleType } = job.data;
      logger.info({ jobId: job.id, assetId, sourceType }, 'Started processing media asset');

      try {
        // Mark as processing in DB
        await supabase
          .from('media_assets')
          .update({ analysis_status: 'processing' })
          .eq('id', assetId);

        let finalVerdict = 'Unknown';
        let confidence = 0.0;
        let detections = [];

        // Logic branching based on asset kind
        if (sourceType.startsWith('image/')) {
           const analysis = await analyzeImageWithAI(sourceUrl, bundleType, logger);
           finalVerdict = analysis.summary;
           confidence = analysis.confidence;
           detections = analysis.detections || [];
        } else if (sourceType.startsWith('video/')) {
           // For videos, we extract sampled frames and analyze them consecutively 
           const frames = await extractVideoFrames(sourceUrl, logger);
           // Oversimplified for Phase E Foundation:
           finalVerdict = `Video analyzed (${frames.length} keyframes).`;
           confidence = 0.85; 
        }

        // Store detections
        if (detections.length > 0) {
            const mapped = detections.map(d => ({
              asset_id: assetId,
              detection_type: d.type,
              label: d.label,
              confidence: d.confidence,
            }));
            await supabase.from('media_detections').insert(mapped);
        }

        // Finalize asset status
        await supabase
          .from('media_assets')
          .update({ 
            analysis_status: 'completed',
            analysis_summary: finalVerdict,
            analysis_confidence: confidence 
          })
          .eq('id', assetId);

        logger.info({ assetId, finalVerdict }, 'Media processed successfully');

      } catch (err) {
        logger.error({ err, assetId }, 'Error processing media asset');
        await supabase
          .from('media_assets')
          .update({ analysis_status: 'failed', analysis_summary: err.message })
          .eq('id', assetId);
        throw err; // Trigger BullMQ retry
      }
    },
    { connection: redisConfig, concurrency: 2 } // CPX62 allows decent concurrency
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Media Job failed completely');
  });

  return worker;
}
