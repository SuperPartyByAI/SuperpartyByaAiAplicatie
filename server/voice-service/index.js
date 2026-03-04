// index.js (Voice Service)
import 'dotenv/config';
import express from "express";
import cors from "cors";
import fs from "fs";
import path from 'path';
import twilio from 'twilio';
import { WebSocketServer } from 'ws';
import { GoogleAuth } from "google-auth-library";
import pino from "pino";
import promClient from 'prom-client';

// Supabase Adapter
import { supabase, db } from './supabase-sync.mjs';

const app = express();
app.use(cors());

// Parse raw body for Twilio signatures, JSON for others
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

const PORT = process.env.PORT || 3001;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Twilio Config
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWIML_APP_SID = process.env.TWIML_APP_SID || process.env.TWILIO_TWIML_APP_SID;
const twilioClient = (TWILIO_SID && TWILIO_TOKEN) ? twilio(TWILIO_SID, TWILIO_TOKEN) : null;

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
  if (request.url.startsWith('/voip-ws')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const identity = url.searchParams.get('identity');
      
      ws.isAlive = true;
      ws.voipIdentity = identity;
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('message', (msg) => {
        try {
          const parsed = JSON.parse(msg);
          if (parsed.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
        } catch(e) {}
      });
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

/* =========================================================
   TWILIO VOIP ENDPOINTS 
========================================================= */

// Extracting Identity from Register
app.post('/api/voice/registerDevice', async (req, res) => {
  const { userId, deviceId, fcmToken } = req.body;
  
  if (!userId || !deviceId || !fcmToken) {
    return res.status(400).json({ error: 'Missing userId, deviceId, or fcmToken' });
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
        onConflict: 'user_id,device_id'
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

app.get('/api/voice/getVoipToken', async (req, res) => {
  try {
    const userId = req.query.userId;
    const deviceId = req.query.deviceId;

    if (!TWILIO_SID || !TWILIO_TOKEN) {
      return res.status(500).json({ error: 'Twilio not configured properly.' });
    }

    if (!userId || !deviceId) {
       return res.status(400).json({ error: 'Missing userId or deviceId.' });
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

app.post('/api/voice/incoming', async (req, res) => {
    console.log('[PBX Twilio] Incoming Call Webhook Fired:', req.body);
    const { From, To, CallSid } = req.body;
    const twiml = new twilio.twiml.VoiceResponse();
  
    try {
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
        const actionUrl = `${BASE_URL}/api/voice/dial-status`;
        const dial = twiml.dial({ 
          answerOnBridge: true,
          timeout: 60, 
          action: actionUrl 
        });
  
        const payload = {
          type: 'incoming_call',
          callerNumber: From,
          callSid: CallSid
        };
  
        dial.client(targetClient.id);
  
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

app.post('/api/voice/dial-status', (req, res) => {
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

app.post('/api/voice/status', async (req, res) => {
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

app.post('/api/voice/cancel', async (req, res) => {
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
app.post('/api/voice/callback', async (req, res) => {
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
    const actionUrl = `${BASE_URL}/api/voice/dial-status`;

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
app.post('/api/voice/bridge-agent', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ language: 'ro-RO' }, 'Se transferă apelul, vă rugăm așteptați.');
  twiml.dial({ answerOnBridge: true }).client(req.body.targetAgentIdentity);
  res.type('text/xml');
  res.send(twiml.toString());
});

app.get('/api/voice/calls', async (req, res) => {
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

app.get('/api/voice/calls/:sid', async (req, res) => {
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
