import { queryRows, insertRow, updateRow } from './supabase.mjs';
import { notifyCentralaOnTripAnomaly } from './notifications.mjs';

/**
 * services/trip-evaluator.mjs
 * Evaluează cursele pe baza mișcărilor GPS și a evenimentelor Geofence,
 * aplicând cele 9 reguli operaționale de business (Phase 20).
 */

const HQ_GEOFENCE_ID = 'HQ'; // Placeholder for HQ ID identifier

export async function evaluateTrip(tripId) {
  // 1. Fetch Trip Data
  const trips = await queryRows('driver_trips', { id: tripId }, { limit: 1 });
  if (!trips || trips.length === 0) throw new Error('Trip not found');
  const trip = trips[0];
  
  // 2. Fetch Event Data (if attached to an event)
  let event = null;
  if (trip.event_id) {
    const events = await queryRows('events', { id: trip.event_id }, { limit: 1 });
    if (events && events.length > 0) event = events[0];
  }

  // 3. Fetch Geofence Events & Movements
  const geofenceEvents = await queryRows('geofence_events', { trip_id: tripId }, { limit: 500 });
  const movements = await queryRows('employee_movements', { employee_id: trip.employee_id }, { limit: 1000 }); // Ideally filter by trip time bounding box

  // === AI Evaluation Flags Initialization ===
  const flags = [];
  let aiVerdict = 'OK';
  let overallDeviationScore = 0;
  let totalLatenessMinutes = 0;
  
  // Rule Definitions:
  // 1. late_to_hq
  // 2. late_to_event
  // 3. left_hq_too_late
  // 4. route_deviation
  // 5. insufficient_dwell_at_hq
  // 6. left_event_too_early
  // 7. no_show_suspected
  // 8. gps_signal_gap
  // 9. geofence_conflict

  // --- Example Implementations for Foundation ---
  
  // Rule: late_to_hq (Did they enter HQ geofence after planned departure/arrival?)
  // For context, we need planned_departure_at on the trip.
  if (trip.planned_departure_at) {
    const plannedHQArrival = new Date(trip.planned_departure_at);
    // Find first ENTER HQ event
    const hqEnter = geofenceEvents.find(e => e.identifier === HQ_GEOFENCE_ID && e.action === 'ENTER');
    
    if (hqEnter) {
        const actualHQArrival = new Date(hqEnter.recorded_at);
        const diffMinutes = Math.round((actualHQArrival - plannedHQArrival) / 60000);
        if (diffMinutes > 15) {
            flags.push({
                rule: 'late_to_hq',
                confidence: 0.95,
                evidence: `Arrived at HQ at ${actualHQArrival.toISOString()}, ${diffMinutes} mins late.`,
                recommended_action: 'warning',
                requires_human_review: true,
                impact_minutes: -diffMinutes
            });
            totalLatenessMinutes += diffMinutes;
        }
    } else if (trip.trip_type === 'hq_to_event') {
        flags.push({
            rule: 'no_show_suspected',
            confidence: 0.80,
            evidence: 'Never entered HQ geofence for HQ->Event trip.',
            recommended_action: 'reject',
            requires_human_review: true,
            impact_minutes: -120 // Huge penalty placeholder
        });
    }
  }

  // Rule: gps_signal_gap
  if (movements.length > 0) {
      let maxGapMinutes = 0;
      // assuming movements are ordered chronologically locally or from DB
      const sortedMovements = [...movements].sort((a,b) => new Date(a.recorded_at) - new Date(b.recorded_at));
      for (let i = 1; i < sortedMovements.length; i++) {
          const gap = (new Date(sortedMovements[i].recorded_at) - new Date(sortedMovements[i-1].recorded_at)) / 60000;
          if (gap > maxGapMinutes) maxGapMinutes = gap;
      }
      if (maxGapMinutes > 30) {
          flags.push({
            rule: 'gps_signal_gap',
            confidence: 1.0,
            evidence: `Lost signal for ${Math.round(maxGapMinutes)} consecutive minutes.`,
            recommended_action: 'investigate',
            requires_human_review: true,
            impact_minutes: 0
          });
          overallDeviationScore += 20;
      }
  }

  // Generate Evidence Bundle for the Evaluation
  const bundlePayload = {
      event_id: trip.event_id,
      trip_id: trip.id,
      employee_id: trip.employee_id,
      bundle_type: 'event_presence', // or 'trip_audit'
      status: 'completed',
      summary: `Trip Evaluated. ${flags.length} flags found.`,
      confidence: 0.90, // Baseline algorithmic confidence
      human_review_status: flags.some(f => f.requires_human_review) ? 'pending' : 'approved'
  };

  const bundleResult = await insertRow('evidence_bundles', bundlePayload);

  // Determine Overall AI Verdict
  if (flags.length > 0) {
      const hasReject = flags.some(f => f.recommended_action === 'reject');
      aiVerdict = hasReject ? 'REJECT' : 'WARNING';
      
      // Impact Suggestions per Flag
      for (const flag of flags) {
           await insertRow('staff_hours_candidates', {
               employee_id: trip.employee_id,
               event_id: trip.event_id,
               trip_id: trip.id,
               candidate_type: `penalty_${flag.rule}`,
               minutes: flag.impact_minutes,
               source_bundle_id: bundleResult.id,
               ai_confidence: flag.confidence,
               requires_human_approval: flag.requires_human_review,
               review_status: 'pending'
           });
      }
  } else {
      aiVerdict = 'APPROVED';
  }

  // Update Trip with Evaluation Results
  await updateRow('driver_trips', trip.id, {
      ai_verdict: aiVerdict,
      delay_minutes: totalLatenessMinutes,
      deviation_score: overallDeviationScore,
      human_review_status: aiVerdict === 'APPROVED' ? 'approved' : 'pending'
  });

  // PASUL 3: Execute Operational Push Policy to Centrala (FCM / WebSockets dispatch)
  await notifyCentralaOnTripAnomaly(trip.id, trip.employee_id, aiVerdict, flags, overallDeviationScore);

  return {
      trip_id: trip.id,
      verdict: aiVerdict,
      flags,
      bundle_id: bundleResult?.id
  };
}
