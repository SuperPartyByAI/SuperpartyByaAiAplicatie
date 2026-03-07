/**
 * routes/media.mjs
 * Video / Image Batch Analysis API
 *
 * POST /media/assets  — register a media asset (link, owner, event)
 * POST /media/jobs    — create an analysis job for a media asset
 * GET  /media/jobs/:id — check job status
 * GET  /media/assets/:id — get asset + jobs
 */

import { Router } from 'express';
import { insertRow, getRow, queryRows } from '../services/supabase.mjs';
import { enqueueAnalysisJob } from '../workers/analysis-worker.mjs';

const router = Router();

/**
 * POST /media/assets
 * { sourceUrl, ownerEmployeeId?, eventId?, sourceType?, cameraLabel?, capturedAt? }
 */
router.post('/assets', async (req, res) => {
  const { sourceUrl, ownerEmployeeId, eventId, sourceType, cameraLabel, capturedAt } = req.body;
  if (!sourceUrl) return res.status(400).json({ error: 'sourceUrl required' });

  try {
    const asset = await insertRow('media_assets', {
      source_url: sourceUrl,
      owner_employee_id: ownerEmployeeId ?? null,
      event_id: eventId ?? null,
      source_type: sourceType ?? 'upload',
      camera_label: cameraLabel ?? null,
      captured_at: capturedAt ?? null,
      analysis_status: 'pending',
    });
    return res.status(201).json({ ok: true, asset });
  } catch (err) {
    req.log?.error({ err }, '[media/assets] error');
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /media/jobs
 * { mediaAssetId, jobType? }
 * jobType: "image_analysis" | "video_analysis" (default: image_analysis)
 */
router.post('/jobs', async (req, res) => {
  const { mediaAssetId, jobType = 'image_analysis' } = req.body;
  if (!mediaAssetId) return res.status(400).json({ error: 'mediaAssetId required' });

  try {
    const job = await insertRow('analysis_jobs', {
      media_asset_id: mediaAssetId,
      status: 'pending',
      job_type: jobType,
    });

    // Enqueue in BullMQ for async processing
    await enqueueAnalysisJob({ jobId: job.id, mediaAssetId, jobType });

    return res.status(201).json({ ok: true, job });
  } catch (err) {
    req.log?.error({ err }, '[media/jobs] error');
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /media/jobs/:id
 */
router.get('/jobs/:id', async (req, res) => {
  try {
    const job = await getRow('analysis_jobs', req.params.id);
    return res.json(job);
  } catch (err) {
    return res.status(404).json({ error: 'Job not found' });
  }
});

/**
 * GET /media/assets/:id — includes jobs for this asset
 */
router.get('/assets/:id', async (req, res) => {
  try {
    const asset = await getRow('media_assets', req.params.id);
    const jobs = await queryRows('analysis_jobs', { media_asset_id: req.params.id });
    return res.json({ asset, jobs });
  } catch (err) {
    return res.status(404).json({ error: 'Asset not found' });
  }
});

export default router;
