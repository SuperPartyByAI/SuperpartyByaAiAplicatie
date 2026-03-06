// index.js (Voice Service)
import 'dotenv/config';
import express from "express";
import cors from "cors";
import fs from "fs";
import path from 'path';
import twilio from 'twilio';
import { WebSocketServer } from 'ws';
import fetch from "node-fetch";
import jwt from "jsonwebtoken";
import { GoogleAuth } from "google-auth-library";
import pino from "pino";
import promClient from 'prom-client';
import Redis from 'ioredis';

// Supabase Adapter
import { supabase, db } from './supabase-sync.mjs';

const app = express();
app.use(cors());
app.set('trust proxy', true);

// Parse raw body for Twilio signatures, JSON for others
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

const PORT = process.env.PORT || 3001;
// BASE_URL is used to build callback URLs Twilio must reach.
// Keep it externally reachable (IP or https domain).
const BASE_URL = (process.env.BASE_URL || process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ENV_PUBLIC_URL = (process.env.PUBLIC_URL || process.env.BASE_URL || '').replace(/\/$/, '');

// Twilio Config
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWIML_APP_SID = process.env.TWIML_APP_SID || process.env.TWILIO_TWIML_APP_SID;
const twilioClient = (TWILIO_SID && TWILIO_TOKEN) ? twilio(TWILIO_SID, TWILIO_TOKEN) : null;

// ─────────────────────────────────────────────────────────────
// WS JWT SECRET (FAIL-FAST, NO FALLBACK)
// ─────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL ERROR: JWT_SECRET environment variable is missing!');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// Supabase Bearer Auth (for app-originated endpoints)
// ─────────────────────────────────────────────────────────────
async function requireSupabaseUser(req, res, next) {
  try {
    const auth = req.get('authorization') || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ ok: false, error: 'missing_bearer' });
    const token = m[1];
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ ok: false, error: 'invalid_bearer' });
    req.supabaseUser = data.user;
    req.supabaseAccessToken = token;
    return next();
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'auth_error' });
  }
}

// ─────────────────────────────────────────────────────────────
// Twilio Webhook Signature Validation
// ─────────────────────────────────────────────────────────────
function getPublicBaseUrl(req) {
  const explicit = process.env.PUBLIC_URL || process.env.BASE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http');
  return `${proto}://${req.get('host')}`.replace(/\/$/, '');
}

// External base URL to hand to Twilio in TwiML + REST callbacks.
// Prefer explicit env (PUBLIC_URL/BASE_URL), else fall back to request host.
function getExternalBaseUrl(req) {
  return ENV_PUBLIC_URL || getPublicBaseUrl(req);
}

function requireTwilioSignature(req, res, next) {
  try {
    if (!TWILIO_TOKEN) return res.status(500).send('twilio_not_configured');
    const signature = req.get('x-twilio-signature');
    if (!signature) return res.status(403).send('missing_twilio_signature');
    const url = getPublicBaseUrl(req) + req.originalUrl;
    const params = req.body || {};
    const ok = twilio.validateRequest(TWILIO_TOKEN, signature, url, params);
    if (!ok) return res.status(403).send('invalid_twilio_signature');
    return next();
  } catch (e) {
    return res.status(403).send('twilio_signature_error');
  }
}
// ── PROMETHEUS METRICS ──────────────────────────────────────────────────────
const promRegistry = new promClient.Registry();
promClient.collectDefaultMetrics({ register: promRegistry });

const mActiveCallsCount = new promClient.Gauge({
  name: 'voice_active_calls_count',
  help: 'Number of currently active calls (from Redis ZSET)',
  registers: [promRegistry],
});
const mSnapshotSentTotal = new promClient.Counter({
  name: 'voice_ws_snapshot_sent_total',
  help: 'Total active-calls-snapshots sent to WS clients',
  registers: [promRegistry],
});
const mReconcileReqTotal = new promClient.Counter({
  name: 'voice_reconcile_requests_total',
  help: 'Total GET /api/voice/active-calls reconcile requests',
  registers: [promRegistry],
});
const mWsClients = new promClient.Gauge({
  name: 'voice_ws_connected_clients',
  help: 'Currently connected WebSocket clients',
  registers: [promRegistry],
});
const mCallEndedTotal = new promClient.Counter({
  name: 'voice_call_ended_events_total',
  help: 'Total call_ended events processed',
  registers: [promRegistry],
});
const mFcmUnregisteredTotal = new promClient.Counter({
  name: 'voice_fcm_unregistered_total',
  help: 'Total FCM UNREGISTERED token cleanups',
  registers: [promRegistry],
});

// Update ws_connected_clients gauge every 15s
setInterval(() => {
  try { mWsClients.set(wss?.clients?.size || 0); } catch (_) {}
}, 15000);

// Update active_calls_count gauge every 30s
setInterval(async () => {
  try {
    const calls = await getActiveCalls();
    mActiveCallsCount.set(calls.length);
  } catch (_) {}
}, 30000);

// Logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
});

// VoIP Client Registry
const registeredVoipClients = new Map();
const pushAckMap = new Map();
const wave2Map = new Map();
// ── REDIS-BACKED ACTIVE CALL STORE ──────────────────────────────────────────
// Replaces in-memory activeCallsMap. Survives container restart.
// Keys: active_call:<callSid>  TTL: 10 minutes
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const CALL_TTL_SEC = 600; // 10 min
const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 });
redis.on('error', (e) => console.warn('[Redis] Error:', e.message));
redis.connect()
  .then(() => console.log('[Redis] Connected to', REDIS_URL))
  .catch(e => console.error('[Redis] Connect failed:', e.message));

// ZSET index tracks active CallSids — O(log N), safe at scale
const ACTIVE_IDX = 'active_calls_idx'; // sorted set: score=startedAt, member=callSid

async function setActiveCall(callSid, data) {
  try {
    const payload = { ...data, startedAt: Date.now() };
    await redis.setex(`active_call:${callSid}`, CALL_TTL_SEC, JSON.stringify(payload));
    // Add to index with score = startedAt (for range queries + cleanup)
    await redis.zadd(ACTIVE_IDX, Date.now(), callSid);
    // Expire index member via sorted set — prune entries older than TTL
  } catch (e) { console.warn('[Redis] setActiveCall failed:', e.message); }
}

async function deleteActiveCall(callSid) {
  try {
    await redis.del(`active_call:${callSid}`);
    await redis.zrem(ACTIVE_IDX, callSid);      // Remove from index
  } catch (e) { console.warn('[Redis] deleteActiveCall failed:', e.message); }
}

async function getActiveCalls() {
  try {
    // Prune stale index entries (calls older than TTL)
    const staleBeforeMs = Date.now() - CALL_TTL_SEC * 1000;
    await redis.zremrangebyscore(ACTIVE_IDX, '-inf', staleBeforeMs);
    // Fetch all current callSids from index
    const sids = await redis.zrange(ACTIVE_IDX, 0, -1);
    if (!sids.length) return [];
    const values = await redis.mget(...sids.map(sid => `active_call:${sid}`));
    return values.filter(Boolean).map(v => { try { return JSON.parse(v); } catch { return null; } }).filter(Boolean);
  } catch (e) { console.warn('[Redis] getActiveCalls failed:', e.message); return []; }
}


// ── ZSET Prune Cron (5 min) — removes orphaned ACTIVE_IDX members ─────────────
// Gap closed: if a call ends abnormally (crash/network), ZREM may not run,
// leaving orphaned members in ACTIVE_IDX after active_call:* key TTL expires.
async function pruneStaleZsetMembers() {
  try {
    const sids = await redis.zrange(ACTIVE_IDX, 0, -1);
    if (!sids.length) return;
    const values = await redis.mget(...sids.map(sid => `active_call:${sid}`));
    const orphans = sids.filter((_, i) => values[i] === null);
    if (orphans.length > 0) {
      await redis.zrem(ACTIVE_IDX, ...orphans);
      console.log(`[Redis] Prune: removed ${orphans.length} orphaned ZSET members:`, orphans);
    }
    // Belt+suspenders: score-based TTL prune
    await redis.zremrangebyscore(ACTIVE_IDX, '-inf', Date.now() - CALL_TTL_SEC * 1000);
  } catch (e) { console.warn('[Redis] pruneStaleZsetMembers error:', e.message); }
}
setInterval(pruneStaleZsetMembers, 5 * 60 * 1000);
// ─────────────────────────────────────────────────────────────────────────────

// --- FCM UNREGISTERED token cleanup ---
async function markFcmTokenUnregistered(identity, deviceToken) {
  try {
    if (identity) {
      await supabase
        .from('device_tokens')
        .update({ fcm_token: 'WS_ONLY' })
        .eq('device_identity', identity);
      const info = registeredVoipClients.get(identity);
      if (info) { info.fcmToken = 'WS_ONLY'; registeredVoipClients.set(identity, info); }
      mFcmUnregisteredTotal.inc();
      console.log(`[FCM] Marked UNREGISTERED → WS_ONLY for identity=${identity}`);
      return;
    }
    if (deviceToken) {
      await supabase
        .from('device_tokens')
        .update({ fcm_token: 'WS_ONLY' })
        .eq('fcm_token', deviceToken);
      console.log(`[FCM] Marked UNREGISTERED → WS_ONLY for token=${deviceToken.substring(0, 10)}...`);
    }
  } catch (e) {
    console.warn('[FCM] Failed to cleanup UNREGISTERED token:', e?.message || e);
  }
}

// --- FCM v1 Push Helper ---
async function sendFcmPush(deviceToken, payload, identity = null) {
  try {
    const auth = new GoogleAuth({
      keyFile: path.join(process.cwd(), 'gpt-firebase-key.json'),
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    const projectId = 'superparty-frontend';
    const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          data: payload,
          android: { priority: 'high' },
          apns: { headers: { 'apns-priority': '10' } }
        }
      })
    });

    const bodyText = await response.text();
    if (!response.ok) {
      console.error('[FCM] Push failed:', response.status, bodyText);
      // Auto-cleanup UNREGISTERED tokens
      try {
        const j = JSON.parse(bodyText);
        const details = j?.error?.details || [];
        const fcmErr = details.find(d => d?.errorCode) || null;
        if (fcmErr?.errorCode === 'UNREGISTERED') {
          await markFcmTokenUnregistered(identity, deviceToken);
        }
      } catch (_) { /* ignore JSON parse errors */ }
    } else {
      console.log('[FCM] Push sent successfully to', deviceToken.substring(0, 15) + '...');
    }
  } catch (err) {
    console.error('[FCM] Error sending push:', err);
  }
}

// WebSocket Push helper
function sendIncomingToIdentity(identity, payload) {
  let delivered = false;
  wss.clients.forEach((client) => {
    if (client.isAlive && client.readyState === 1 /* WebSocket.OPEN */) {
      if (client.voipIdentity === identity) {
        client.send(JSON.stringify(payload));
        delivered = true;
      }
    }
  });
  return delivered;
}

// Returns Set of identity strings currently connected via WebSocket
function getWsOnlineIdentitySet() {
  const s = new Set();
  try {
    wss.clients.forEach((client) => {
      if (client && client.isAlive && client.readyState === 1 && client.voipIdentity) {
        s.add(client.voipIdentity);
      }
    });
  } catch (_) {}
  return s;
}

// Load devices on startup
async function loadDeviceTokensFromDB() {
  try {
    const { data, error } = await supabase
      .from('device_tokens')
      .select('device_identity, user_id, device_id, fcm_token, last_seen_at')
      .order('last_seen_at', { ascending: false });
    if (!error && data) {
      for (const row of data) {
        registeredVoipClients.set(row.device_identity, {
          userId: row.user_id,
          deviceId: row.device_id,
          fcmToken: row.fcm_token,
          registeredAt: row.last_seen_at
        });
      }
      console.log(`[VoIP DB] Loaded ${data.length} device(s) into registry`);
    }
  } catch (e) {
    console.error('[VoIP DB] Exception loading device_tokens:', e.message);
  }
}
loadDeviceTokensFromDB();

// WS Token Generation
app.get('/api/auth/get-ws-token', requireSupabaseUser, (req, res) => {
  const identity = req.query.identity;
  if (!identity) return res.status(400).json({ error: 'Missing identity parameter' });
  
  // Prevent generating WS token for someone else's identity
  const uid = req.supabaseUser.id;
  if (!identity.startsWith(`user_${uid}_dev_`)) {
    return res.status(403).json({ error: 'identity_not_owned' });
  }
  
  // strictly uses global JWT_SECRET
  const token = jwt.sign({ identity }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, identity });
});

// Health Check
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', promRegistry.contentType);
    res.end(await promRegistry.metrics());
  } catch (e) { res.status(500).end(e.message); }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: "ok", service: "voice-service" });
});

app.get('/', (req, res) => res.send('Superparty Voice Service is running'));

const server = app.listen(PORT, () => {
    console.log(`[Voice Service] Started on port ${PORT}`);
    console.log(`[Voice Service] BASE_URL: ${BASE_URL}`);
});

// WebSocket Server
const wss = new WebSocketServer({ noServer: true });
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.on('upgrade', (request, socket, head) => {
  console.log(`[WS UPGRADE] Received upgrade request for URL: ${request.url}`);
  try {
    if (request.url.includes('/voip-ws')) {
      console.log(`[WS UPGRADE] URL matched '/voip-ws'! Executing wss.handleUpgrade...`);
      wss.handleUpgrade(request, socket, head, (ws) => {
        console.log(`[WS UPGRADE] handleUpgrade callback triggered! Socket upgraded successfully.`);
        const url = new URL(request.url, `http://${request.headers.host}`);
        const token = url.searchParams.get('token');
        const identityParam = url.searchParams.get('identity');
        
        console.log(`[WS UPGRADE] Parsed token: ${token ? 'YES' : 'NO'}, Parsed identityParam: ${identityParam || 'NONE'}`);
        let identity = identityParam;
        
        if (token && token.length > 0) {
          // strictly uses global JWT_SECRET
          console.log(`[WS UPGRADE] Verifying JWT token...`);
        try {
          const decoded = jwt.verify(token, JWT_SECRET);
          identity = decoded.identity;
        } catch(e) {
          console.error('[WS] Invalid JWT token:', e.message);
          ws.close(1008, 'Invalid token');
          return;
        }
      }

        if (!identity) {
          console.error('[WS UPGRADE] No identity provided -> ws.close(1008)');
          ws.close(1008, 'Missing identity or token');
          return;
        }
        
        console.log(`[WS UPGRADE] Identity verified: ${identity}. Finalizing connection state.`);
        ws.isAlive = true;
        ws.voipIdentity = identity;
        ws.on('pong', () => { ws.isAlive = true; });
        ws.on('message', (msg) => {
          try {
            const parsed = JSON.parse(msg);
            if (parsed.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
          } catch(e) {}
        });
        console.log(`[WS UPGRADE] Emitting wss connection event for custom handlers.`);
        wss.emit('connection', ws, request);
        // Snapshot: send active calls to this client immediately on connect
        try {
          // Load from Redis (durable source of truth)
          getActiveCalls().then(snap => {
            try {
              ws.send(JSON.stringify({ type: 'active-calls-snapshot', activeCalls: snap }));
              mSnapshotSentTotal.inc();
              console.log(`[WS] Snapshot sent to ${identity}: ${snap.length} active calls (Redis)`);
            } catch(e) {}
          }).catch(() => {});
        } catch(e) {}
      });
    } else {
      console.error(`[WS UPGRADE] URL '${request.url}' did NOT match '/voip-ws'! Destroying socket.`);
      socket.destroy();
    }
  } catch (e) {
    console.error(`[WS UPGRADE] EXCEPTION in upgrade handler:`, e);
    socket.destroy();
  }
});

/* =========================================================
   TWILIO VOIP ENDPOINTS 
========================================================= */

app.post('/api/voice/push-ack', express.json(), (req, res) => {
  try {
    const { callSid, identity, ackToken } = req.body;
    if (!callSid || !identity || !ackToken) {
      return res.status(400).json({ error: 'missing_params' });
    }

    // If call is no longer pending on this node → late ACK, no error
    if (!pushAckMap.has(callSid)) {
      return res.status(200).json({ ok: false, late: true });
    }

    let decoded;
    try {
      decoded = jwt.verify(ackToken, JWT_SECRET);
    } catch (err) {
      if (err?.name === 'TokenExpiredError') {
        // Expired token → return 200 (no 403 spam), do not add to ack map
        console.debug(`[PBX ACK] Late/expired ack for ${callSid} from ${identity} (token expired)`);
        return res.status(200).json({ ok: false, expired: true });
      }
      console.error('[PBX ACK] verify error:', err?.message || err);
      return res.status(403).json({ error: 'invalid_token' });
    }

    if (!decoded || decoded.callSid !== callSid) {
      return res.status(403).json({ error: 'invalid_ack_token' });
    }

    pushAckMap.get(callSid).add(identity);
    console.log(`[PBX ACK] Received push-ack for ${callSid} from ${identity}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[PBX ACK] unexpected error:', err?.message || err);
    res.status(500).json({ error: 'internal' });
  }
});

// Extracting Identity from Register
app.post('/api/voice/registerDevice', requireSupabaseUser, async (req, res) => {
  const { userId, deviceId } = req.body;
  const fcmToken = req.body.fcmToken || 'WS_ONLY';
  
  if (!userId || !deviceId) {
    return res.status(400).json({ error: 'Missing userId or deviceId' });
  }
  if (userId !== req.supabaseUser.id) {
    return res.status(403).json({ error: 'user_mismatch' });
  }

  try {
    const identity = `user_${userId}_dev_${deviceId}`;
    const { data, error } = await supabase
      .from('device_tokens')
      .upsert({
        user_id: req.supabaseUser.id,
        device_id: deviceId,
        device_identity: identity,
        fcm_token: fcmToken || 'WS_ONLY',
        last_seen_at: new Date().toISOString()
      }, { onConflict: 'user_id, device_id' });

    if (error) {
      console.error('[VoIP PBX] Error saving device token:', error.message);
      return res.status(500).json({ error: 'Failed to save token' });
    }

    registeredVoipClients.set(identity, { userId, deviceId, fcmToken, registeredAt: new Date().toISOString() });
    console.log(`[VoIP PBX] Registered generic device ${identity} with token ${fcmToken?.substring(0, 10)}...`);
    
    res.json({ success: true, identity });
  } catch (error) {
    console.error('[VoIP PBX] Error in registerDevice:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/voice/getVoipToken', requireSupabaseUser, async (req, res) => {
  try {
    const userId = req.query.userId;
    const deviceId = req.query.deviceId;

    if (!TWILIO_SID || !TWILIO_TOKEN) {
      return res.status(500).json({ error: 'Twilio not configured properly.' });
    }

    if (!userId || !deviceId) {
       return res.status(400).json({ error: 'Missing userId or deviceId.' });
    }
    if (userId !== req.supabaseUser.id) {
      return res.status(403).json({ error: 'user_mismatch' });
    }

    const { data: devices, error } = await supabase
      .from('device_tokens')
      .select('device_identity')
      .eq('user_id', userId)
      .eq('device_id', deviceId)
      .limit(1);

    if (error || !devices || devices.length === 0) {
      console.warn(`[VoIP PBX] generate token failed - Identity not found for userId: ${userId}, deviceId: ${deviceId}`);
      return res.status(404).json({ error: 'Identity not found. Register device first.' });
    }

    const identity = devices[0].device_identity;

    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: TWIML_APP_SID,
      incomingAllow: true, 
    });

    if (process.env.TWILIO_PUSH_CREDENTIAL_SID) {
        voiceGrant.pushCredentialSid = process.env.TWILIO_PUSH_CREDENTIAL_SID;
    }

    const token = new AccessToken(
      TWILIO_SID,
      process.env.TWILIO_API_KEY_SID,
      process.env.TWILIO_API_KEY_SECRET,
      { identity: identity }
    );

    token.addGrant(voiceGrant);
    
    console.log(`[VoIP PBX] Token generated for identity: ${identity}`);
    res.json({ token: token.toJwt(), identity });
  } catch (e) {
    console.error('[VoIP PBX] Error generating Twilio token:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/voice/incoming', requireTwilioSignature, async (req, res) => {
    const { From, To, CallSid } = req.body
  // State durabil în Redis — single source of truth (activeCallsMap eliminat)
  if (CallSid) await setActiveCall(CallSid, { callSid: CallSid, from: From||'', to: To||Called||'', startedAt: Date.now() });
    console.log(`[PBX Twilio] Incoming Call Webhook Fired. From: ${From}, To: ${To}, CallSid: ${CallSid}`);
    const twiml = new twilio.twiml.VoiceResponse();
  
    try {
      let cleanTo = To ? To.replace('client:', '') : '';
      if (!cleanTo && req.body.Called) {
          cleanTo = req.body.Called.replace('client:', '');
      }

      if (cleanTo.startsWith('conf_')) {
        console.log(`[PBX Twilio] OUTBOUND conference join (To=${To}, cleanTo=${cleanTo}, From=${From}, CallSid=${CallSid})`);
        const outDial = twiml.dial({ callerId: process.env.TWILIO_CALLER_ID });
        outDial.conference({ beep: false, startConferenceOnEnter: true, endConferenceOnExit: true }, cleanTo);
        res.type('text/xml');
        return res.send(twiml.toString());
      }

      if (From && From.startsWith('client:')) {
        // OUTBOUND CALL (App -> World)
        console.log(`[PBX Twilio] Outbound detected from ${From} to ${To}`);
        const outDial = twiml.dial({ callerId: process.env.TWILIO_CALLER_ID });
        outDial.number(cleanTo);
        res.type('text/xml');
        return res.send(twiml.toString());
      }

      // INCOMING CALL (From World -> To Mobile App)
      const confName = `conf_${CallSid}`;
      twiml.say({ language: 'ro-RO' }, 'Vă conectăm acum. Vă rugăm să aşteptaţi.');

      let identities = [];
      for (const [id, info] of registeredVoipClients) {
        identities.push({ id, ...info });
      }
      identities.sort((a, b) => new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime());

      // Filter: exclude WS_ONLY devices that are not currently WS-connected
      const wsOnline = getWsOnlineIdentitySet();
      const candidates = identities.filter(c => {
        const online = wsOnline.has(c.id);
        const hasFcm = !!c.fcmToken && c.fcmToken !== 'WS_ONLY';
        return online || hasFcm;
      });

      let targetClients = candidates.slice(0, 3); // Top 3 deliverable devices
  
      if (targetClients.length === 0) {
        console.warn('[PBX Twilio] In-memory registry empty, loading from Supabase...');
        try {
          const { data } = await supabase
            .from('device_tokens')
            .select('device_identity, user_id, device_id, fcm_token, last_seen_at')
            .order('last_seen_at', { ascending: false })
            .limit(20); // fetch more, then filter down to deliverable
          if (data && data.length > 0) {
            const recovered = data.map(row => {
              const clientInfo = {
                id: row.device_identity,
                userId: row.user_id, deviceId: row.device_id,
                fcmToken: row.fcm_token, registeredAt: row.last_seen_at
              };
              registeredVoipClients.set(row.device_identity, clientInfo);
              return clientInfo;
            });
            const wsOnline2 = getWsOnlineIdentitySet();
            const recoveredCandidates = recovered.filter(c => {
              const online = wsOnline2.has(c.id);
              const hasFcm = !!c.fcmToken && c.fcmToken !== 'WS_ONLY';
              return online || hasFcm;
            });
            targetClients = recoveredCandidates.slice(0, 3);
            console.log(`[PBX Twilio] Recovered ${recoveredCandidates.length} deliverable clients from Supabase. Using ${targetClients.length} for Wave-1.`);
          }
        } catch (e) {
          console.error('[PBX Twilio] DB fallback failed:', e.message);
        }
      }
  
      if (targetClients.length === 0) {
        console.warn('[PBX Twilio] No VoIP clients registered! Hanging up.');
        twiml.say({ language: 'ro-RO' }, 'Ne cerem scuze, niciun agent nu este disponibil in acest moment.');
      } else {
        targetClients.forEach(tc => console.log(`[PBX Twilio] Target VoIP client fan-out: ${tc.id}`));

        const actionUrl = `${getExternalBaseUrl(req)}/api/voice/dial-status`;
        const dial = twiml.dial({ action: actionUrl, timeout: 60 });
        dial.conference({
          beep: false,
          startConferenceOnEnter: true,
          endConferenceOnExit: true,
          waitUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.ambient'
        }, confName);
  
        const ACK_TOKEN_TTL = process.env.ACK_TOKEN_TTL || '15m';
        const ackToken = jwt.sign({ callSid: CallSid }, JWT_SECRET, { expiresIn: ACK_TOKEN_TTL });
        pushAckMap.set(CallSid, new Set());

        const payload = {
          type: 'incoming_call',
          callerNumber: From,
          callSid: CallSid,
          ackToken: ackToken
        };
  
        targetClients.forEach(client => {
          const deliveredViaWs = sendIncomingToIdentity(client.id, payload);
          if (deliveredViaWs) {
            console.log(`[PBX Twilio] Woke client ${client.id} instantly via WebSocket`);
          } else if (client.fcmToken && client.fcmToken !== 'WS_ONLY') {
            console.log(`[PBX Twilio] Sending FCM Push to wake client: ${client.id}`);
            sendFcmPush(client.fcmToken, payload, client.id);
          }
        });

        // Asynchronous ACK wait queue (Wave 1 & Wave 2)
        let ACK_WAIT_MS = parseInt(process.env.ACK_WAIT_MS || '7000', 10);
        let POLL_INTERVAL_MS = 100;
        let maxIterations = Math.floor(ACK_WAIT_MS / POLL_INTERVAL_MS);

        setTimeout(async () => {
          let winnerIdentity = null;
          let currentTargets = [...targetClients]; // Tracks who we pushed to

          // WAIT FOR WAVE 1
          for (let i = 0; i < maxIterations; i++) {
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
            const acks = pushAckMap.get(CallSid);
            if (acks && acks.size > 0) {
               winnerIdentity = Array.from(acks)[0];
               break;
            }
          }

          // IF NO WAVE 1 WINNER -> FIRE WAVE 2
          if (!winnerIdentity) {
            console.log(`[PBX] Call ${CallSid} had NO ACKs within ${ACK_WAIT_MS}ms! Initiating Wave-2 Fallback...`);
            let wave2Clients = candidates.slice(3, 6);
            if (wave2Clients.length > 0) {
              console.log(`[PBX] Wave-2 target clients: ${wave2Clients.map(c => c.id).join(', ')}`);
              currentTargets = [...currentTargets, ...wave2Clients]; // Add Wave 2 to allowed winners
              wave2Map.set(CallSid, wave2Clients); // save for cancel on winner
              setTimeout(() => wave2Map.delete(CallSid), 60_000); // safety cleanup

              wave2Clients.forEach(client => {
                const deliveredViaWs = sendIncomingToIdentity(client.id, payload);
                if (deliveredViaWs) {
                  console.log(`[PBX Twilio] Wave-2 Woke client ${client.id} instantly via WebSocket`);
                } else if (client.fcmToken && client.fcmToken !== 'WS_ONLY') {
                  console.log(`[PBX Twilio] Wave-2 FCM Push to: ${client.id}`);
                  sendFcmPush(client.fcmToken, payload, client.id);
                }
              });

              // WAIT FOR WAVE 2
              for (let i = 0; i < maxIterations; i++) {
                await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
                const acks = pushAckMap.get(CallSid);
                if (acks && acks.size > 0) {
                   winnerIdentity = Array.from(acks)[0];
                   break;
                }
              }
            } else {
              console.log('[PBX] Wave-2: No additional agents available for fallback.');
            }
          }

          // Strict Winner Validation (must be in any of the waves we fired)
          if (winnerIdentity && !currentTargets.some(tc => tc.id === winnerIdentity)) {
             console.warn(`[PBX] Warning: ACK winner ${winnerIdentity} is NOT in currentTargets! Ignoring.`);
             winnerIdentity = null;
          }

          if (winnerIdentity) {
            console.log(`[PBX] Call ${CallSid} WON by ${winnerIdentity}. Canceling others.`);
            currentTargets.forEach(client => {
              if (client.id !== winnerIdentity) {
                const cancelPayload = { type: 'CANCEL_RINGING_UI', target_action: 'CANCEL_RINGING_UI', callSid: CallSid };
                if (!sendIncomingToIdentity(client.id, cancelPayload)) {
                   if (client.fcmToken && client.fcmToken !== 'WS_ONLY') sendFcmPush(client.fcmToken, cancelPayload, client.id);
                }
              }
            });
            // Also cancel any Wave-2 devices that were notified but not in currentTargets
            const w2Cancel = wave2Map.get(CallSid) || [];
            w2Cancel.forEach(client => {
              if (client.id !== winnerIdentity) {
                const cancelPayload = { type: 'CANCEL_RINGING_UI', target_action: 'CANCEL_RINGING_UI', callSid: CallSid };
                if (!sendIncomingToIdentity(client.id, cancelPayload)) {
                  if (client.fcmToken && client.fcmToken !== 'WS_ONLY') sendFcmPush(client.fcmToken, cancelPayload, client.id);
                }
              }
            });
            wave2Map.delete(CallSid);
          } else {
            console.log(`[PBX] Call ${CallSid} had NO ACKs even after Wave-2! Ringing timeout.`);
          }
          
          setTimeout(() => {
            pushAckMap.delete(CallSid);
            wave2Map.delete(CallSid);
          }, 10000); // Cleanup maps later
        }, 0);
      }
    } catch (e) {
      console.error('[PBX Twilio] Incoming webhook error:', e);
      twiml.say({ language: 'ro-RO' }, 'Eroare la procesarea apelului.');
    }
  
    res.type('text/xml');
    res.send(twiml.toString());
});

// ─────────────────────────────────────────────────────────────
// Idempotency for /api/voice/accept is now strictly enforced by the Supabase `call_accepts` table.
// ─────────────────────────────────────────────────────────────

app.post('/api/voice/accept', requireSupabaseUser, express.json(), async (req, res) => {
  try {
    console.log('[/api/voice/accept] incoming body:', req.body);
    const { callSid, clientIdentity } = req.body;

    if (!callSid) {
      return res.status(400).json({ ok: false, error: 'missing callSid' });
    }
    // ──────── LEVEL 2 ENTERPRISE IDEMPOTENCY ────────
    const { error: insertError } = await supabase
      .from('call_accepts')
      .insert({ call_sid: callSid });
      
    if (insertError) {
      if (insertError.code === '23505') { // Postgres Unique Violation
        console.log(`[PBX DB-Locks] Deduplicated callSid at scale: ${callSid}`);
        return res.json({ ok: true, dedupe: true });
      }
      console.error('[PBX] Error recording call accept in DB:', insertError.message);
      return res.status(500).json({ ok: false, error: 'Database idempotency constraint failed' });
    }
    if (!clientIdentity) {
      return res.status(400).json({ ok: false, error: 'missing clientIdentity' });
    }

    // Ownership check: clientIdentity must belong to authenticated user
    {
      const { data, error } = await supabase
        .from('device_tokens')
        .select('user_id')
        .eq('device_identity', clientIdentity)
        .limit(1);
      if (error || !data || data.length === 0) {
        return res.status(403).json({ ok: false, error: 'identity_not_registered' });
      }
      if (data[0].user_id !== req.supabaseUser.id) {
        return res.status(403).json({ ok: false, error: 'identity_not_owned' });
      }
    }

    const confName = `conf_${callSid}`;
    let toNumber = clientIdentity;

    if (!toNumber) return res.status(400).json({ ok: false, error: 'no deviceNumber available' });
    if (!toNumber.includes('+') && !toNumber.startsWith('client:')) toNumber = `client:${toNumber}`;

    console.log('[/api/voice/accept] creating Twilio call to', toNumber, ' bridging into ', confName);
    try {
      const call = await twilioClient.calls.create({
        to: toNumber,
        from: process.env.TWILIO_CALLER_ID,
        url: `${getExternalBaseUrl(req)}/api/voice/join-conference?conf=${encodeURIComponent(confName)}`
      });
      return res.json({ ok: true, callSid: call.sid });
    } catch (twilioError) {
      console.error('[PBX] Twilio call creation failed, rolling back idempotency lock:', twilioError.message);
      await supabase.from('call_accepts').delete().eq('call_sid', callSid);
      return res.status(500).json({ ok: false, error: 'Twilio call failed, lock rolled back' });
    }
  } catch (err) {
    console.error('[/api/voice/accept] unexpected error', err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

app.post('/api/voice/hangup', requireSupabaseUser, express.json(), async (req, res) => {
  const { callSid, clientIdentity } = req.body || {};
  if (!callSid) return res.status(400).json({ ok: false, error: 'missing callSid' });

  try {
    const confName = `conf_${callSid}`;
    console.log('[/api/voice/hangup] Terminating Conference', confName);

    // Optional ownership check if clientIdentity is provided
    if (clientIdentity) {
      const { data } = await supabase
        .from('device_tokens')
        .select('user_id')
        .eq('device_identity', clientIdentity)
        .limit(1);
      if (!data || data.length === 0 || data[0].user_id !== req.supabaseUser.id) {
        return res.status(403).json({ ok: false, error: 'identity_not_owned' });
      }
    }

    try {
      if (twilioClient) {
        const confs = await twilioClient.conferences.list({ friendlyName: confName, status: 'in-progress', limit: 1 });
        if (confs.length > 0) {
          await twilioClient.conferences(confs[0].sid).update({ status: 'completed' });
        }
      }
    } catch (restErr) {
      console.warn('[/api/voice/hangup] Twilio Conference could not be updated', restErr.message);
    }
    
    // Attempt to hangup the parent call as well
    try {
      if (twilioClient) await twilioClient.calls(callSid).update({ status: 'completed' });
    } catch (e) {}

    if (wss && wss.clients) {
      const payload = JSON.stringify({ type: 'call_closed', conf: confName, by: 'server_hangup' });
      wss.clients.forEach(c => {
        if (c.readyState === 1 && c.voipIdentity) c.send(payload);
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[/api/voice/hangup] Fatal error closing call', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/voice/join-conference', requireTwilioSignature, express.urlencoded({ extended: false }), (req, res) => {
  console.log('[/api/voice/join-conference] joining conf:', req.query.conf);
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  const dial = twiml.dial();
  dial.conference({
    startConferenceOnEnter: true,
    endConferenceOnExit: true
  }, req.query.conf);
  res.type('text/xml').send(twiml.toString());
});

app.post('/api/voice/dial-status', requireTwilioSignature, (req, res) => {
    console.log('[PBX Twilio] Dial Status Webhook:', req.body);
    const twiml = new twilio.twiml.VoiceResponse();
    const dialCallStatus = req.body.DialCallStatus;
    
    if (dialCallStatus === 'completed' || dialCallStatus === 'answered') {
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    console.log(`[PBX Twilio] Call ${req.body.CallSid} not answered (${dialCallStatus}). Fallback...`);
    twiml.say({ language: 'ro-RO' }, 'Ne pare rău, agentul nu a putut răspunde la apel.');
    
    res.type('text/xml');
    res.send(twiml.toString());
});

app.post('/api/voice/status', requireTwilioSignature, async (req, res) => {
    console.log('[PBX Twilio] Master Call Status Webhook:', req.body);
    const { CallSid, CallStatus } = req.body;
    if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(CallStatus)) {
        deleteActiveCall(CallSid).catch(()=>{}); // Remove from Redis + ZSET index
        mCallEndedTotal.inc();
        console.log(`[PBX Twilio] Call ${CallSid} ended with status ${CallStatus}. Clearing Redis + notifying WS.`);
        const payload = { type: 'call_ended', callSid: CallSid };
        wss.clients.forEach((client) => {
            if (client.readyState === 1) client.send(JSON.stringify(payload));
        });
    }
    res.sendStatus(200);
});

app.get('/api/voice/active-calls', requireSupabaseUser, async (req, res) => {
  mReconcileReqTotal.inc();
  try {
    const calls = await getActiveCalls();
    mActiveCallsCount.set(calls.length);
    res.json({ activeCalls: calls });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/voice/cancel', requireSupabaseUser, async (req, res) => {
    const { callSid } = req.body;
    try {
      console.log(`[PBX Twilio] /api/voice/cancel requested for CallSid: ${callSid}`);
      if (twilioClient) {
        await twilioClient.calls(callSid).update({ status: 'completed' });
        res.json({ ok: true });
      } else {
        res.json({ ok: false, error: 'Twilio Client Not Initialized' });
      }
    } catch (e) {
      console.error('[PBX Twilio] Error canceling call:', e);
      res.json({ ok: false, error: e.message });
    }
});


// Callback logic for Dialing Outbounds (Agent to Client)
app.post('/api/voice/callback', requireSupabaseUser, async (req, res) => {
  const { fromDevice, toPhoneNumber } = req.body;
  
  if (!fromDevice || !toPhoneNumber) {
    return res.status(400).json({ error: 'Missing fromDevice or toPhoneNumber' });
  }

  try {
    const { data: dbTokens, error } = await supabase
      .from('device_tokens')
      .select('device_identity')
      .eq('device_identity', fromDevice);

    if (error || !dbTokens || dbTokens.length === 0) {
      console.warn(`[VoIP PBX] Agent ${fromDevice} not in Supabase, outbound failed`);
      return res.status(404).json({ error: 'Agent not registered' });
    }

    const confName = 'agentOutbound_' + Date.now();
    const actionUrl = `${getExternalBaseUrl(req)}/api/voice/dial-status`;

    const clientCall = await twilioClient.calls.create({
      to: toPhoneNumber,
      from: process.env.TWILIO_PHONE_NUMBER || '+1234567890',
      twiml: `<Response><Dial action="${actionUrl}"><Conference>${confName}</Conference></Dial></Response>`
    });

    const agentCall = await twilioClient.calls.create({
      to: `client:${fromDevice}`,
      from: process.env.TWILIO_PHONE_NUMBER || '+1234567890',
      twiml: `<Response><Dial action="${actionUrl}"><Conference>${confName}</Conference></Dial></Response>`
    });

    res.json({
        success: true,
        message: 'Bridging agent and client',
        clientCallSid: clientCall.sid,
        agentCallSid: agentCall.sid,
        conferenceName: confName
    });

  } catch (err) {
    console.error('[VoIP PBX] Error initiating outbound callback:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/voice/makeCall — triggered by CallsScreen "callback" button
// Body: { to: "+407xxxxxxx", userId: "uuid" }
// Resolves the caller's device identity from Supabase, then bridges PSTN + agent via conference.
app.post('/api/voice/makeCall', requireSupabaseUser, express.json(), async (req, res) => {
  const { to } = req.body;
  const userId = req.supabaseUser?.id;
  if (!to) {
    return res.status(400).json({ error: 'Missing to' });
  }

  // Normalize to E.164
  let toE164 = to.toString().trim();
  // fix: +07... → +407...
  if (toE164.startsWith('+0')) {
    toE164 = '+40' + toE164.substring(2);
  } else if (!toE164.startsWith('+')) {
    if (toE164.startsWith('00')) toE164 = '+' + toE164.substring(2);
    else if (/^\d+$/.test(toE164) && toE164.startsWith('0') && toE164.length >= 9) toE164 = '+40' + toE164.substring(1);
    else toE164 = '+40' + toE164;
  }
  if (!/^\+\d{8,15}$/.test(toE164)) {
    return res.status(400).json({ error: 'invalid_number', to: toE164 });
  }

  try {
    // Resolve device identity for this user (most recently registered device)
    const { data: devices, error } = await supabase
      .from('device_tokens')
      .select('device_identity')
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false })
      .limit(1);

    if (error || !devices || devices.length === 0) {
      console.warn(`[makeCall] No device found for userId=${userId}`);
      return res.status(404).json({ error: 'No registered device for this user' });
    }

    const agentIdentity = devices[0].device_identity;
    const confName = 'outbound_' + Date.now();
    const actionUrl = `${getExternalBaseUrl(req)}/api/voice/dial-status`;
    const callerNumber = process.env.TWILIO_CALLER_ID || process.env.TWILIO_PHONE_NUMBER;

    console.log(`[makeCall] Bridging agent=${agentIdentity} to PSTN=${toE164} via conf=${confName}`);

    // Leg 1: Call the PSTN number
    const pstnCall = await twilioClient.calls.create({
      to: toE164,
      from: callerNumber,
      twiml: `<Response><Dial action="${actionUrl}"><Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="true">${confName}</Conference></Dial></Response>`
    });

    // Leg 2: Call the agent's device (SDK client)
    const agentCall = await twilioClient.calls.create({
      to: `client:${agentIdentity}`,
      from: callerNumber,
      twiml: `<Response><Dial action="${actionUrl}"><Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="false">${confName}</Conference></Dial></Response>`
    });

    console.log(`[makeCall] ✅ pstnSid=${pstnCall.sid} agentSid=${agentCall.sid}`);
    res.json({ ok: true, pstnCallSid: pstnCall.sid, agentCallSid: agentCall.sid, conferenceName: confName });

  } catch (err) {
    console.error('[makeCall] Error:', err.message || err);
    res.status(500).json({ error: err.message || 'Internal error' });
  }
});


// Outgoing bridging (if used by specific webhooks or legacy integrations)
app.post('/api/voice/bridge-agent', requireTwilioSignature, (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ language: 'ro-RO' }, 'Se transferă apelul, vă rugăm așteptați.');
  twiml.dial({ answerOnBridge: true }).client(req.body.targetAgentIdentity);
  res.type('text/xml');
  res.send(twiml.toString());
});

app.get('/api/voice/calls', requireSupabaseUser, async (req, res) => {
    try {
      if (!twilioClient) {
         return res.status(500).json({ error: 'Twilio Client Nu Este Configurat.' });
      }
      const cutoffStr = new Date(Date.now() - 48*3600*1000).toISOString();
      const calls = await twilioClient.calls.list({ startTimeAfter: new Date(cutoffStr), limit: 100 });
      res.json(calls);
    } catch (e) {
      console.error('[VoIP PBX] Eroare la citirea apelurilor din Twilio:', e);
      res.status(500).json({ error: e.message });
    }
});

app.get('/api/voice/calls/:sid', requireSupabaseUser, async (req, res) => {
    try {
      if (!twilioClient) {
         return res.status(500).json({ error: 'Twilio Client Nu Este Configurat.' });
      }
      const sid = req.params.sid;
      const call = await twilioClient.calls(sid).fetch();
      res.json(call);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
});
