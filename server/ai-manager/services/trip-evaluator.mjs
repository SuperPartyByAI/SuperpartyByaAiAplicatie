import { queryRows, insertRow, updateRow } from './supabase.mjs';
import { notifyCentralaOnTripAnomaly } from './notifications.mjs';

/**
 * services/trip-evaluator.mjs
 * Evaluează cursele pe baza mișcărilor GPS și a evenimentelor Geofence,
 * aplicând cele 9 reguli operaționale de business (Phase 20).
 */

const HQ_GEOFENCE_ID = 'HQ';

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
  const movements = await queryRows('employee_movements', { employee_id: trip.employee_id }, { limit: 1000 });

  const flags = [];
  let aiVerdict = 'OK';
  let overallDeviationScore = 0;
  let totalLatenessMinutes = 0;

  // Sorting artifacts chronologically
  const sortedMovements = [...movements].sort((a,b) => new Date(a.recorded_at) - new Date(b.recorded_at));
  const sortedGeofences = [...geofenceEvents].sort((a,b) => new Date(a.recorded_at) - new Date(b.recorded_at));

  // Extracted core geofence events
  const hqEnters = sortedGeofences.filter(e => e.identifier === HQ_GEOFENCE_ID && e.action === 'ENTER');
  const hqExits = sortedGeofences.filter(e => e.identifier === HQ_GEOFENCE_ID && e.action === 'EXIT');
  const eventEnters = sortedGeofences.filter(e => e.identifier === trip.event_id && e.action === 'ENTER');
  const eventExits = sortedGeofences.filter(e => e.identifier === trip.event_id && e.action === 'EXIT');

  // --- SCORE RULES ---

  // 1. late_to_hq
  if (trip.planned_arrival_hq_at) {
    const plannedHQArrival = new Date(trip.planned_arrival_hq_at);
    if (hqEnters.length > 0) {
        const actualHQArrival = new Date(hqEnters[0].recorded_at);
        const diffMinutes = Math.round((actualHQArrival - plannedHQArrival) / 60000);
        if (diffMinutes > 15) {
            flags.push({ rule: 'late_to_hq', confidence: 0.95, evidence: `Arrived HQ ${diffMinutes} mins late.`, recommended_action: 'warning', requires_human_review: true, impact_minutes: -diffMinutes });
            totalLatenessMinutes += diffMinutes;
            overallDeviationScore += 10;
        }
    }
  }

  // 2. late_to_event
  if (event && event.start_at) {
    const plannedEventArrival = new Date(event.start_at);
    if (eventEnters.length > 0) {
        const actualEventArrival = new Date(eventEnters[0].recorded_at);
        const diffMinutes = Math.round((actualEventArrival - plannedEventArrival) / 60000);
        if (diffMinutes > 15) {
            flags.push({ rule: 'late_to_event', confidence: 0.98, evidence: `Arrived Event ${diffMinutes} mins late.`, recommended_action: 'warning', requires_human_review: true, impact_minutes: -diffMinutes });
            totalLatenessMinutes += diffMinutes;
            overallDeviationScore += 15;
        }
    }
  }

  // 3. left_hq_too_late
  if (trip.planned_departure_hq_at) {
    const plannedDeparture = new Date(trip.planned_departure_hq_at);
    if (hqExits.length > 0) {
        const actualDeparture = new Date(hqExits[0].recorded_at);
        const diffMinutes = Math.round((actualDeparture - plannedDeparture) / 60000);
        if (diffMinutes > 15) {
            flags.push({ rule: 'left_hq_too_late', confidence: 0.95, evidence: `Departed HQ ${diffMinutes} mins late.`, recommended_action: 'warning', requires_human_review: true, impact_minutes: -Number(Math.round(diffMinutes/2)) }); // Partial penalty
            overallDeviationScore += 5;
        }
    }
  }

  // 4. route_deviation
  if (trip.km_actual && trip.km_estimate) {
      if (trip.km_actual > trip.km_estimate * 1.3 && (trip.km_actual - trip.km_estimate) > 5) {
         const dev = Math.round(trip.km_actual - trip.km_estimate);
         flags.push({ rule: 'route_deviation', confidence: 0.85, evidence: `Driven ${dev} extra km over estimate.`, recommended_action: 'investigate', requires_human_review: true, impact_minutes: 0 });
         overallDeviationScore += 15;
      }
  }

  // 5. insufficient_dwell_at_hq
  if (hqEnters.length > 0 && hqExits.length > 0) {
      const enterDtm = new Date(hqEnters[0].recorded_at);
      // Find the first exit that happened AFTER the enter
      const validExit = hqExits.find(e => new Date(e.recorded_at) > enterDtm);
      if (validExit) {
          const dwellMinutes = Math.round((new Date(validExit.recorded_at) - enterDtm) / 60000);
          if (dwellMinutes >= 0 && dwellMinutes < 5) { // Less than 5 min loading equipment? Suspect.
             flags.push({ rule: 'insufficient_dwell_at_hq', confidence: 0.90, evidence: `Dwell HQ was only ${dwellMinutes} mins. Equipment check missing?`, recommended_action: 'warning', requires_human_review: true, impact_minutes: 0 });
             overallDeviationScore += 10;
          }
      }
  }

  // 6. left_event_too_early
  if (event && event.end_at) {
     const plannedEnd = new Date(event.end_at);
     if (eventExits.length > 0) {
         // The last exit
         const actualExit = new Date(eventExits[eventExits.length - 1].recorded_at);
         const diffMinutes = Math.round((plannedEnd - actualExit) / 60000);
         if (diffMinutes > 15) { // Left more than 15 mins before event officially ends
             flags.push({ rule: 'left_event_too_early', confidence: 0.98, evidence: `Left event ${diffMinutes} mins early.`, recommended_action: 'warning', requires_human_review: true, impact_minutes: -diffMinutes });
             overallDeviationScore += 15;
         }
     }
  }

  // 7. no_show_suspected
  if (trip.event_id && eventEnters.length === 0) {
     flags.push({ rule: 'no_show_suspected', confidence: 0.80, evidence: 'Never entered Event geofence during trip.', recommended_action: 'reject', requires_human_review: true, impact_minutes: -120 });
     overallDeviationScore += 50;
  }

  // 8. gps_signal_gap
  if (sortedMovements.length > 0) {
      let maxGapMinutes = 0;
      for (let i = 1; i < sortedMovements.length; i++) {
          const gap = (new Date(sortedMovements[i].recorded_at) - new Date(sortedMovements[i-1].recorded_at)) / 60000;
          if (gap > maxGapMinutes) maxGapMinutes = gap;
      }
      if (maxGapMinutes > 30) {
          flags.push({ rule: 'gps_signal_gap', confidence: 1.0, evidence: `Lost signal for ${Math.round(maxGapMinutes)} consecutive minutes.`, recommended_action: 'investigate', requires_human_review: true, impact_minutes: 0 });
          overallDeviationScore += 20;
      }
  }

  // 9. geofence_conflict
  if (sortedGeofences.length > 1) {
      for (let i = 1; i < sortedGeofences.length; i++) {
         const prev = sortedGeofences[i-1];
         const curr = sortedGeofences[i];
         if (prev.action === 'ENTER' && curr.action === 'ENTER' && prev.identifier !== curr.identifier) {
             const timeDiff = (new Date(curr.recorded_at) - new Date(prev.recorded_at)) / 60000;
             if (timeDiff < 2) { // Cannot jump distinct geofences in under 2 mins
                 flags.push({ rule: 'geofence_conflict', confidence: 0.95, evidence: `Jumped from ${prev.identifier} to ${curr.identifier} in ${Math.round(timeDiff)} mins. Spoofing?`, recommended_action: 'investigate', requires_human_review: true, impact_minutes: 0 });
                 overallDeviationScore += 25;
                 break; // Record once per trip
             }
         }
      }
  }

  // === EVIDENCE BUNDLE ===
  const bundlePayload = {
      event_id: trip.event_id,
      trip_id: trip.id,
      employee_id: trip.employee_id,
      bundle_type: 'trip_audit',
      status: 'completed',
      summary: `Trip Evaluated. ${flags.length} flags found. Score: ${overallDeviationScore}`,
      confidence: 0.90,
      human_review_status: flags.length > 0 ? 'pending' : 'approved'
  };

  const bundleResult = await insertRow('evidence_bundles', bundlePayload);

  // === VERDICT & IMPACT SUGGESTIONS ===
  if (flags.length > 0) {
      const hasReject = flags.some(f => f.recommended_action === 'reject');
      aiVerdict = hasReject || overallDeviationScore > 40 ? 'REJECT' : 'WARNING';
      
      for (const flag of flags) {
           await insertRow('staff_hours_candidates', {
               employee_id: trip.employee_id,
               event_id: trip.event_id,
               trip_id: trip.id,
               candidate_type: `penalty_${flag.rule}`,
               minutes: flag.impact_minutes || 0,
               source_bundle_id: bundleResult.id,
               ai_confidence: flag.confidence,
               requires_human_approval: flag.requires_human_review,
               review_status: 'pending'
           });
      }
  } else {
      aiVerdict = 'APPROVED';
  }

  await updateRow('driver_trips', trip.id, {
      ai_verdict: aiVerdict,
      delay_minutes: totalLatenessMinutes,
      deviation_score: overallDeviationScore,
      human_review_status: aiVerdict === 'APPROVED' ? 'approved' : 'pending'
  });

  // PASUL 3: Execute Operational Push Policy to Centrala (FCM / WebSockets sync)
  await notifyCentralaOnTripAnomaly(trip.id, trip.employee_id, aiVerdict, flags, overallDeviationScore);

  return {
      trip_id: trip.id,
      verdict: aiVerdict,
      flags,
      bundle_id: bundleResult?.id
  };
}
