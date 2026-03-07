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
    employee_id: employeeId,
    event_id: eventId,
    status: 'active',
    planned_route: plannedRoute,
    actual_route: { points: [] },
    started_at: new Date().toISOString(),
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
    actual_route: { points },
    km_actual: kmActual,
    fuel_estimate_liters: fuelEstimate,
    ended_at: new Date().toISOString(),
  });

  return trip;
}
