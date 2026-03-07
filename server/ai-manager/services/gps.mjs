/**
 * services/gps.mjs
 * GPS / Trip management logic.
 * Handles employee movement tracking, geofence detection, ETA, lateness.
 */

import { insertRow, updateRow, queryRows } from './supabase.mjs';
import { config } from '../config/config.mjs';

const EARTH_RADIUS_KM = 6371;

/**
 * Haversine distance in meters between two lat/lng points.
 */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1000;
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Check if a point is inside a geofence circle.
 */
export function isInsideGeofence(pointLat, pointLng, centerLat, centerLng, radiusM) {
  return distanceMeters(pointLat, pointLng, centerLat, centerLng) <= radiusM;
}

/**
 * Check if employee is currently near HQ (sediu).
 */
export function isAtSediu(lat, lng) {
  return isInsideGeofence(
    lat, lng,
    config.gps.sediu.lat,
    config.gps.sediu.lng,
    config.gps.sediu.radiusM
  );
}

/**
 * Estimate fuel consumption (L/100km) — default 8L/100km.
 */
export function estimateFuelLiters(kmActual, litersPer100 = 8) {
  return Math.round((kmActual * litersPer100) / 100 * 100) / 100;
}

/**
 * Estimate distance from a list of location points (cumulative).
 * @param {Array<{lat,lng}>} points
 * @returns {number} km
 */
export function estimateKmFromPoints(points) {
  if (points.length < 2) return 0;
  let totalM = 0;
  for (let i = 1; i < points.length; i++) {
    totalM += distanceMeters(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }
  return Math.round((totalM / 1000) * 100) / 100;
}

/**
 * Start a new driver trip.
 */
export async function startTrip({ employeeId, eventId = null, plannedRoute = null }) {
  const trip = await insertRow('driver_trips', {
    driver_user_id: employeeId,  // Ext. via migration 007 (employee_id remains natively mapped by user identity)
    employee_id: employeeId,
    event_id: eventId,
    status: 'active',
    planned_route: plannedRoute,
    actual_route: { points: [] },
    started_at: new Date().toISOString(),
    route_status: 'started',
    actual_departure_at: new Date().toISOString()
  });
  return trip;
}

/**
 * Record a location point for an active trip.
 * Also detects geofence transitions.
 */
export async function recordLocation({
  employeeId,
  tripId,
  lat,
  lng,
  accuracyMeters = null,
  speedKmh = null,
  recordedAt = null,
}) {
  const ts = recordedAt ?? new Date().toISOString();

  // Save movement point
  await insertRow('employee_movements', {
    employee_id: employeeId,
    trip_id: tripId,
    lat,
    lng,
    accuracy_meters: accuracyMeters,
    speed_kmh: speedKmh,
    recorded_at: ts,
  });

  // Check geofences
  const geofenceResults = [];
  if (isAtSediu(lat, lng)) {
    geofenceResults.push({ geofence_id: 'sediu', geofence_type: 'dwell' });
  }

  // Save geofence events if triggered
  for (const gf of geofenceResults) {
    await insertRow('geofence_events', {
      employee_id: employeeId,
      trip_id: tripId,
      geofence_id: gf.geofence_id,
      geofence_type: gf.geofence_type,
      lat,
      lng,
      recorded_at: ts,
      ai_decision: `Employee detected ${gf.geofence_type} geofence: ${gf.geofence_id}`,
    });
  }

  return { recorded: true, geofences_triggered: geofenceResults };
}

/**
 * Record a batch of location points for an active trip.
 * Optimized for background GPS tracking (offline buffering).
 */
export async function recordLocationsBatch(locations) {
  if (!Array.isArray(locations) || locations.length === 0) return { recorded: 0, geofences_triggered: [] };

  const insertPromises = [];
  const allGeofenceResults = [];

  // Group by tripId for potential bulk insert logic later, but for now iterate
  for (const loc of locations) {
    const { employeeId, tripId, lat, lng, accuracyMeters, speedKmh, recordedAt } = loc;
    const ts = recordedAt ?? new Date().toISOString();

    // Fire and forget or collect promises
    insertPromises.push(
      insertRow('employee_movements', {
        employee_id: employeeId,
        trip_id: tripId,
        lat: Number(lat),
        lng: Number(lng),
        accuracy_meters: accuracyMeters === null ? null : Number(accuracyMeters),
        speed_kmh: speedKmh === null ? null : Number(speedKmh),
        recorded_at: ts,
      })
    );

    // We mainly care about geofence triggers for the MOST RECENT points, 
    // but for completeness we can evaluate all. 
    if (isAtSediu(lat, lng)) {
      allGeofenceResults.push({ employeeId, tripId, geofence_id: 'sediu', geofence_type: 'dwell', lat, lng, ts });
    }
  }

  // Wait for all point inserts
  await Promise.allSettled(insertPromises);

  // If geofences triggered, save them 
  // (In real prod, we would debounce this to avoid 50 "enter" events in 2 minutes)
  const uniqueGeofences = deduplicateGeofences(allGeofenceResults);
  
  for (const gf of uniqueGeofences) {
    await insertRow('geofence_events', {
      employee_id: gf.employeeId,
      trip_id: gf.tripId,
      geofence_id: gf.geofence_id,
      geofence_type: gf.geofence_type,
      lat: gf.lat,
      lng: gf.lng,
      recorded_at: gf.ts,
      ai_decision: `Batch-detected ${gf.geofence_type} geofence: ${gf.geofence_id}`,
    });
  }

  return { recorded: locations.length, geofences_triggered: uniqueGeofences };
}

function deduplicateGeofences(results) {
  // Simple dedup: if we hit the same geofence in the same batch for the same trip, only keep the last one
  const map = new Map();
  for (const r of results) {
    const key = `${r.tripId}_${r.geofence_id}`;
    map.set(key, r);
  }
  return Array.from(map.values());
}

/**
 * End a trip — compute actual km and fuel estimate.
 */
export async function endTrip(tripId) {
  // Get all movement points for this trip
  const movements = await queryRows('employee_movements', { trip_id: tripId }, {
    limit: 5000,
    orderBy: 'recorded_at',
    ascending: true,
  });

  const points = movements.map(m => ({ lat: Number(m.lat), lng: Number(m.lng) }));
  const kmActual = estimateKmFromPoints(points);
  const fuelEstimate = estimateFuelLiters(kmActual);

  const trip = await updateRow('driver_trips', tripId, {
    status: 'completed',
    route_status: 'completed',
    actual_route: { points },
    km_actual: kmActual,
    fuel_estimate_liters: fuelEstimate,
    ended_at: new Date().toISOString(),
    actual_arrival_at: new Date().toISOString(),
  });

  return trip;
}

/**
 * Record a Geofence Event triggered externally by the mobile App (Phase B2).
 * Formulates the fundamental AI decision framework (Phase B3).
 */
export async function recordGeofenceEvent({ employeeId, identifier, action, lat, lng }) {
  const ts = new Date().toISOString();
  
  // Phase B3 AI Actions Logic
  let aiDecision = '';
  if (identifier === 'SEDIU_SUPERPARTY') {
    if (action === 'ENTER') {
       aiDecision = 'Angajatul a ajuns la Sediu. Aștept instructajul misiunii de la centrală.';
    } else if (action === 'EXIT') {
       aiDecision = 'Angajatul a părăsit Sediul. Misiunea este în desfășurare.';
    } else if (action === 'DWELL') {
       aiDecision = 'Angajatul staționează la sediu (Dwell Confirmat). Urmează preluarea materialelor.';
    }
  } else {
    if (action === 'ENTER') {
      aiDecision = `A ajuns la perimetrul Geofence: ${identifier}`;
    } else if (action === 'EXIT') {
      aiDecision = `A părăsit perimetrul Geofence: ${identifier}`;
    } else {
      aiDecision = `Staționare/Acțiune în Geofence [${identifier}]: ${action}`;
    }
  }

  // To truly link to an active trip, we lookup the most recent active trip for employeeId.
  const activeTrips = await queryRows('driver_trips', { employee_id: employeeId, status: 'active' }, { limit: 1, orderBy: 'started_at', ascending: false });
  const tripId = activeTrips.length > 0 ? activeTrips[0].id : null;

  await insertRow('geofence_events', {
    employee_id: employeeId,
    trip_id: tripId,
    geofence_id: identifier,
    geofence_type: action,
    lat: lat === null ? null : Number(lat),
    lng: lng === null ? null : Number(lng),
    recorded_at: ts,
    ai_decision: aiDecision
  });

  return { recorded: true, ai_decision: aiDecision };
}
