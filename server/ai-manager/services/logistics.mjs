import { supabase, insertRow, queryRows } from './supabase.mjs';

/**
 * Fetch inventory requirements for an event
 */
export async function getInventoryRequirements(eventId) {
  // Join the requirement with the actual inventory item metadata
  const { data, error } = await supabase
    .from('event_inventory_requirements')
    .select(`
      *,
      inventory_items (
        sku,
        name,
        category,
        unit
      )
    `)
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data;
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
    employee_id: employeeId,
    inventory_item_id: inventoryItemId,
    handoff_status: status, // planned, picked_up, delivered, returned, missing, damaged
    ai_confidence: 1.0, // Human reported by default
    updated_at: ts
  };

  if (tripId) payload.trip_id = tripId;

  if (status === 'picked_up') {
    payload.qty_out = qtyOut ?? 0;
    payload.picked_up_at = ts;
    if (pickupProofAssetId) payload.pickup_proof_asset_id = pickupProofAssetId;
  } else if (status === 'returned') {
    payload.qty_returned = qtyReturned ?? 0;
    payload.returned_at = ts;
    if (returnProofAssetId) payload.return_proof_asset_id = returnProofAssetId;
  } else if (status === 'delivered') {
    payload.delivered_at = ts;
  }

  // Find existing handoff to update rather than creating multiple rows per item
  const existingRows = await queryRows('inventory_handoffs', {
    event_id: eventId,
    employee_id: employeeId,
    inventory_item_id: inventoryItemId
  }, { limit: 1 });

  if (existingRows.length > 0) {
    const { data, error } = await supabase
      .from('inventory_handoffs')
      .update(payload)
      .eq('id', existingRows[0].id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  payload.created_at = ts;
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
    summary: summary,
    confidence: confidence,
    human_review_status: 'pending',
    created_at: new Date().toISOString()
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
    minutes: Math.round(Number(minutes) || 0),
    source_bundle_id: sourceBundleId,
    ai_confidence: confidence === null ? null : Number(confidence),
    requires_human_approval: true,
    review_status: 'pending',
    created_at: new Date().toISOString()
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

/**
 * Get all pending Staff Hours Candidates for Admin UI
 */
export async function getPendingStaffHoursCandidates() {
  const { data, error } = await supabase
    .from('staff_hours_candidates')
    .select(`
      *,
      evidence_bundles (*),
      driver_trips(route_status, km_actual, delay_minutes)
    `)
    .eq('review_status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }
  return data;
}

/**
 * Record an Evidence Media Asset
 */
export async function recordMediaAsset({
  eventId,
  tripId,
  employeeId,
  sourceUrl,
  sourceType,
  capturedAt,
  cameraId,
  assetKind
}) {
  const result = await insertRow('media_assets', {
    event_id: eventId,
    trip_id: tripId,
    employee_id: employeeId,
    source_url: sourceUrl,
    source_type: sourceType,
    captured_at: capturedAt || new Date().toISOString(),
    camera_id: cameraId,
    uploaded_by: employeeId,
    asset_kind: assetKind,
    analysis_status: 'pending',
    created_at: new Date().toISOString()
  });
  return result;
}
