import { insertRow, updateRow, queryRows } from './supabase.mjs';

/**
 * Fetch inventory requirements for an event
 */
export async function getInventoryRequirements(eventId) {
  const requirements = await queryRows('event_inventory_requirements', { event_id: eventId }, { limit: 100 });
  return requirements;
}

/**
 * Record an inventory handoff action (e.g., 'picked_up', 'returned', 'missing')
 */
export async function recordInventoryHandoff({
  eventId,
  tripId,
  employeeId,
  inventoryItemId,
  qtyOut,
  qtyReturned,
  status,
  pickupProofAssetId,
  returnProofAssetId,
}) {
  const ts = new Date().toISOString();
  
  const payload = {
    event_id: eventId,
    trip_id: tripId,
    employee_id: employeeId,
    inventory_item_id: inventoryItemId,
    qty_out: qtyOut ?? 0,
    qty_returned: qtyReturned ?? 0,
    handoff_status: status, // planned, picked_up, delivered, returned, missing, damaged
    ai_confidence: 1.0, // Human reported by default
  };

  if (status === 'picked_up') {
    payload.picked_up_at = ts;
    payload.pickup_proof_asset_id = pickupProofAssetId;
  } else if (status === 'returned') {
    payload.returned_at = ts;
    payload.return_proof_asset_id = returnProofAssetId;
  } else if (status === 'delivered') {
    payload.delivered_at = ts;
  }

  const result = await insertRow('inventory_handoffs', payload);
  return result;
}

/**
 * Create or Update an Evidence Bundle
 */
export async function recordEvidenceBundle({
  eventId,
  tripId,
  employeeId,
  bundleType,
  status,
  summary,
  confidence
}) {
  const result = await insertRow('evidence_bundles', {
    event_id: eventId,
    trip_id: tripId,
    employee_id: employeeId,
    bundle_type: bundleType,
    status: status || 'pending',
    summary,
    confidence,
    human_review_status: 'pending'
  });
  return result;
}

/**
 * Create Staff Hours Candidate based on evidence
 */
export async function createStaffHoursCandidate({
  employeeId,
  eventId,
  tripId,
  candidateType,
  minutes,
  sourceBundleId,
  confidence
}) {
  const result = await insertRow('staff_hours_candidates', {
    employee_id: employeeId,
    event_id: eventId,
    trip_id: tripId,
    candidate_type: candidateType,
    minutes,
    source_bundle_id: sourceBundleId,
    ai_confidence: confidence,
    requires_human_approval: true,
    review_status: 'pending'
  });
  return result;
}

/**
 * Review/Approve/Reject Staff Hours Candidate
 */
export async function reviewStaffHoursCandidate({
  candidateId,
  reviewStatus,
  reviewerComment,
  approvedBy
}) {
  const payload = {
    review_status: reviewStatus,
    reviewer_comment: reviewerComment,
    updated_at: new Date().toISOString()
  };

  if (reviewStatus === 'approved') {
    payload.approved_by = approvedBy;
    payload.approved_at = new Date().toISOString();
  }

  const result = await updateRow('staff_hours_candidates', candidateId, payload);
  return result;
}
