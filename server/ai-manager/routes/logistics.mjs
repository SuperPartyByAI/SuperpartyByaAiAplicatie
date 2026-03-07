/**
 * routes/logistics.mjs
 * Logistics, Inventory and Staff Hours API
 */

import { Router } from 'express';
import {
  getInventoryRequirements,
  recordInventoryHandoff,
  recordEvidenceBundle,
  createStaffHoursCandidate,
  reviewStaffHoursCandidate,
  getPendingStaffHoursCandidates,
  recordMediaAsset
} from '../services/logistics.mjs';

const router = Router();

// GET /logistics/inventory/requirements/:eventId
router.get('/inventory/requirements/:eventId', async (req, res) => {
  try {
    const requirements = await getInventoryRequirements(req.params.eventId);
    return res.json({ ok: true, data: requirements });
  } catch (err) {
    req.log?.error({ err }, '[logistics/inventory] error fetching requirements');
    return res.status(500).json({ error: err.message });
  }
});

// POST /logistics/inventory/handoff
router.post('/inventory/handoff', async (req, res) => {
  const { eventId, tripId, employeeId, inventoryItemId, qtyOut, qtyReturned, status, pickupProofAssetId, returnProofAssetId } = req.body;
  if (!eventId || !employeeId || !inventoryItemId || !status) {
    return res.status(400).json({ error: 'eventId, employeeId, inventoryItemId, and status are required' });
  }
  try {
    const result = await recordInventoryHandoff({
      eventId, tripId, employeeId, inventoryItemId, qtyOut, qtyReturned, status, pickupProofAssetId, returnProofAssetId
    });
    return res.status(201).json({ ok: true, data: result });
  } catch (err) {
    req.log?.error({ err }, '[logistics/inventory] handoff error');
    return res.status(500).json({ error: err.message });
  }
});

// POST /logistics/evidence
router.post('/evidence', async (req, res) => {
  const { eventId, tripId, employeeId, bundleType, status, summary, confidence } = req.body;
  try {
    const result = await recordEvidenceBundle({ eventId, tripId, employeeId, bundleType, status, summary, confidence });
    return res.status(201).json({ ok: true, data: result });
  } catch (err) {
    req.log?.error({ err }, '[logistics/evidence] error');
    return res.status(500).json({ error: err.message });
  }
});

// POST /logistics/evidence/assets
router.post('/evidence/assets', async (req, res) => {
  const { eventId, tripId, employeeId, sourceUrl, sourceType, capturedAt, cameraId, assetKind } = req.body;
  if (!employeeId || !sourceUrl || !assetKind) {
    return res.status(400).json({ error: 'employeeId, sourceUrl and assetKind are mandatory' });
  }
  try {
    const result = await recordMediaAsset({ eventId, tripId, employeeId, sourceUrl, sourceType, capturedAt, cameraId, assetKind });
    return res.status(201).json({ ok: true, data: result });
  } catch (err) {
    req.log?.error({ err }, '[logistics/evidence/assets] error');
    return res.status(500).json({ error: err.message });
  }
});

// POST /logistics/staff-hours/candidate
router.post('/staff-hours/candidate', async (req, res) => {
  const { employeeId, eventId, tripId, candidateType, minutes, sourceBundleId, confidence } = req.body;
  try {
    const result = await createStaffHoursCandidate({ employeeId, eventId, tripId, candidateType, minutes, sourceBundleId, confidence });
    return res.status(201).json({ ok: true, data: result });
  } catch (err) {
    req.log?.error({ err }, '[logistics/staff-hours/candidate] error');
    return res.status(500).json({ error: err.message });
  }
});

// POST /logistics/staff-hours/review
router.post('/staff-hours/review', async (req, res) => {
  const { candidateId, reviewStatus, reviewerComment, approvedBy } = req.body;
  if (!candidateId || !reviewStatus) {
    return res.status(400).json({ error: 'candidateId and reviewStatus required' });
  }
  try {
    const result = await reviewStaffHoursCandidate({ candidateId, reviewStatus, reviewerComment, approvedBy });
    return res.json({ ok: true, data: result });
  } catch (err) {
    req.log?.error({ err }, '[logistics/staff-hours/review] error');
    return res.status(500).json({ error: err.message });
  }
});

// GET /logistics/staff-hours/candidates/pending
router.get('/staff-hours/candidates/pending', async (req, res) => {
  try {
    const candidates = await getPendingStaffHoursCandidates();
    return res.json({ ok: true, data: candidates });
  } catch (err) {
    req.log?.error({ err }, '[logistics/staff-hours/pending] error');
    return res.status(500).json({ error: err.message });
  }
});

export default router;
