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
// Logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
});

// VoIP Client Registry
const registeredVoipClients = new Map();

// --- FCM v1 Push Helper ---
async function sendFcmPush(deviceToken, payload) {
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
    
    if (!response.ok) {
      console.error('[FCM] Push failed:', response.status, await response.text());
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
        user_id: userId,
        device_id: deviceId,
        fcm_token: fcmToken,
        device_identity: identity,
        last_seen_at: new Date().toISOString()
      }, {
        onConflict: 'device_identity'
      });

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
    console.log('[PBX Twilio] Incoming Call Webhook Fired:', req.body);
    const { From, To, CallSid } = req.body;
    const twiml = new twilio.twiml.VoiceResponse();
  
    try {
      if (From && From.startsWith('client:')) {
        // OUTBOUND CALL (App -> World)
        console.log(`[PBX Twilio] Outbound detected from ${From} to ${To}`);
        const outDial = twiml.dial({ callerId: process.env.TWILIO_CALLER_ID || '+40373805828' });
        // Clean To number if it comes with prefixes
        const cleanTo = To.replace('client:', '');
        if (cleanTo.startsWith('conf_')) {
          outDial.conference(
            { beep: false, startConferenceOnEnter: true, endConferenceOnExit: true },
            cleanTo
          );
        } else {
          outDial.number(cleanTo);
        }
        res.type('text/xml');
        return res.send(twiml.toString());
      }

      // INCOMING CALL (From World -> To Mobile App)
      // Generate a conference name based on the incoming CallSid
      const confName = `conf_${CallSid}`;
      
      // Short greeting
      twiml.say({ language: 'ro-RO' }, 'Vă conectăm acum. Vă rugăm să aşteptaţi.');

      let identities = [];
      for (const [id, info] of registeredVoipClients) {
        identities.push({ id, ...info });
      }
      identities.sort((a, b) => new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime());
      
      let targetClient = identities.length > 0 ? identities[0] : null;
  
      if (!targetClient) {
        console.warn('[PBX Twilio] In-memory registry empty, loading from Supabase...');
        try {
          const { data } = await supabase
            .from('device_tokens')
            .select('device_identity, user_id, device_id, fcm_token, last_seen_at')
            .order('last_seen_at', { ascending: false })
            .limit(1);
          if (data && data.length > 0) {
            const row = data[0];
            targetClient = {
              id: row.device_identity,
              userId: row.user_id, deviceId: row.device_id,
              fcmToken: row.fcm_token, registeredAt: row.last_seen_at
            };
            registeredVoipClients.set(row.device_identity, targetClient);
            console.log(`[PBX Twilio] Recovered client from Supabase: ${targetClient.id}`);
          }
        } catch (e) {
          console.error('[PBX Twilio] DB fallback failed:', e.message);
        }
      }
  
      console.log(`[PBX Twilio] Target VoIP client: ${targetClient ? targetClient.id : 'NONE'}`);
      
      if (!targetClient) {
        console.warn('[PBX Twilio] No VoIP clients registered! Hanging up.');
        twiml.say({ language: 'ro-RO' }, 'Ne cerem scuze, niciun agent nu este disponibil in acest moment.');
      } else {
        const actionUrl = `${getExternalBaseUrl(req)}/api/voice/dial-status`;
        const dial = twiml.dial({ 
          action: actionUrl,
          timeout: 60
        });
        
        // Put the inbound caller into the Hold Conference
        dial.conference({
          beep: false,
          startConferenceOnEnter: true,
          endConferenceOnExit: true,
          waitUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.ambient'
        }, confName);
  
        const payload = {
          type: 'incoming_call',
          callerNumber: From,
          callSid: CallSid
        };
  
        const deliveredViaWs = sendIncomingToIdentity(targetClient.id, payload);
        
        if (deliveredViaWs) {
          console.log(`[PBX Twilio] Woke client ${targetClient.id} instantly via WebSocket`);
        } else if (targetClient.fcmToken && targetClient.fcmToken !== 'WS_ONLY') {
          console.log(`[PBX Twilio] Sending FCM Push to wake client: ${targetClient.id}`);
          sendFcmPush(targetClient.fcmToken, payload);
        }
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
      if (insertError.code === '42P01') { // Undefined table
        console.warn('[PBX] WARNING: `call_accepts` table missing! Bypassing idempotency lock (Level 1 Fallback). Run the SQL migration.');
      } else {
        console.error('[PBX] Error recording call accept in DB:', insertError.message);
        return res.status(500).json({ ok: false, error: 'Database idempotency constraint failed' });
      }
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
    const call = await twilioClient.calls.create({
      to: toNumber,
      from: process.env.TWILIO_CALLER_ID || '+40373805828',
      url: `${getExternalBaseUrl(req)}/api/voice/join-conference?conf=${encodeURIComponent(confName)}`
    });

    return res.json({ ok: true, callSid: call.sid });
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
        console.log(`[PBX Twilio] Call ${CallSid} ended with status ${CallStatus}. Waking WebSocket clients to clear UI.`);
        const payload = { type: 'call_ended', callSid: CallSid };
        wss.clients.forEach((client) => {
            if (client.readyState === 1) client.send(JSON.stringify(payload));
        });
    }
    res.sendStatus(200);
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
