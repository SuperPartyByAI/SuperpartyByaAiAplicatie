/**
 * routes/trips.mjs
 * GPS / Driver Trip API
 *
 * POST   /trips/start      — start a new trip
 * POST   /trips/location   — record a location point
 * POST   /trips/end        — end trip, compute km + fuel
 * GET    /trips/:id        — get trip details
 */

import { Router } from 'express';
import {
  startTrip,
  recordLocation,
  endTrip,
} from '../services/gps.mjs';
import { getRow } from '../services/supabase.mjs';

const router = Router();

/**
 * POST /trips/start
 * { employeeId, eventId?, plannedRoute? }
 */
router.post('/start', async (req, res) => {
  const { employeeId, eventId, plannedRoute } = req.body;
  if (!employeeId) return res.status(400).json({ error: 'employeeId required' });

  try {
    const trip = await startTrip({ employeeId, eventId, plannedRoute });
    return res.status(201).json({ ok: true, trip });
  } catch (err) {
    req.log?.error({ err }, '[trips/start] error');
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /trips/location
 * { employeeId, tripId, lat, lng, accuracyMeters?, speedKmh?, recordedAt? }
 */
router.post('/location', async (req, res) => {
  const { employeeId, tripId, lat, lng, accuracyMeters, speedKmh, recordedAt } = req.body;
  if (!employeeId || !tripId || lat == null || lng == null) {
    return res.status(400).json({ error: 'employeeId, tripId, lat, lng required' });
  }

  try {
    const result = await recordLocation({
      employeeId,
      tripId,
      lat: Number(lat),
      lng: Number(lng),
      accuracyMeters: accuracyMeters != null ? Number(accuracyMeters) : null,
      speedKmh: speedKmh != null ? Number(speedKmh) : null,
      recordedAt,
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    req.log?.error({ err }, '[trips/location] error');
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /trips/end
 * { tripId }
 */
router.post('/end', async (req, res) => {
  const { tripId } = req.body;
  if (!tripId) return res.status(400).json({ error: 'tripId required' });

  try {
    const trip = await endTrip(tripId);
    return res.json({ ok: true, trip });
  } catch (err) {
    req.log?.error({ err }, '[trips/end] error');
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /trips/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const trip = await getRow('driver_trips', req.params.id);
    return res.json(trip);
  } catch (err) {
    return res.status(404).json({ error: 'Trip not found' });
  }
});

export default router;
