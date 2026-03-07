import { Router } from 'express';
import { Queue } from 'bullmq';
import { insertRow } from '../services/supabase.mjs';
import { config } from '../config/config.mjs';

const router = Router();
let mediaQueue;

// Initialize BullMQ producer
if (config.redis?.host) {
  mediaQueue = new Queue('media-analysis-queue', { connection: config.redis });
}

router.post('/record', async (req, res) => {
  const { eventId, tripId, employeeId, sourceUrl, sourceType, assetKind, bundleType } = req.body;

  if (!sourceUrl || !employeeId) {
    return res.status(400).json({ error: 'sourceUrl and employeeId are required' });
  }

  try {
    // 1. Inserare Media Asset (initial state: pending)
    const assetPayload = {
      event_id: eventId,
      trip_id: tripId,
      employee_id: employeeId,
      source_url: sourceUrl,
      source_type: sourceType, // e.g., 'image/jpeg', 'video/mp4'
      asset_kind: assetKind || 'proof',
      analysis_status: 'pending',
      uploaded_by: employeeId
    };

    const newAsset = await insertRow('media_assets', assetPayload);

    // 2. Queue for analysis if media queue is active
    if (mediaQueue && newAsset && newAsset.id) {
       await mediaQueue.add('analyze-media', {
         assetId: newAsset.id,
         sourceUrl,
         sourceType,
         eventId,
         bundleType // Context for pipeline (e.g. 'arrival_proof')
       });
       req.log?.info({ assetId: newAsset.id }, 'Enqueued media for AI analysis');
    }

    return res.status(201).json({ ok: true, data: newAsset });
  } catch (err) {
    req.log?.error({ err }, '[media/record] Error recording media asset');
    return res.status(500).json({ error: err.message });
  }
});

export default router;
