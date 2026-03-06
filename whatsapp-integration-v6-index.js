import 'dotenv/config';
import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import { requireFirebaseAuth, requireAdminTokenMw } from './auth-middleware.mjs';

// ─── Prometheus metrics setup ────────────────────────────────────────────
import promClient from 'prom-client';
const metricsRegistry = new promClient.Registry();
promClient.collectDefaultMetrics({ register: metricsRegistry });


// index.js
import express from "express";
import cors from "cors";
import fs from "fs";
import path from 'path';
import twilio from 'twilio'; // Twilio Import

import multer from "multer";
const upload = multer({ limits: { fileSize: 25 * 1024 * 1024 }, storage: multer.memoryStorage() });

// ... existing imports ...

import pino from "pino";
import qrcode from "qrcode-terminal";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadAndProcessHistorySyncNotification,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import { makeCustomStore } from "./store.js";
// import { logMessage } from "./sheets.js"; 
/* firebase admin removed */
import { SessionManager } from "./session-manager.js"; // Import SessionManager
import { normalizeToE164 } from "./lib/normalize-phone.js";

const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.05,
  });
}

/* ========== Config ========== */
const PORT = process.env.PORT || 3001;
const LID_MAPPING_FILE = "lid_mappings.json";
const STORE_FILE = "baileys_store_multi.json";

/* ========== Firebase Admin Init ========== */
// DISABLED: import { initFirebase, db, syncMessageToFirestore } from "./firebase-sync.js";
const db = null; const syncMessageToFirestore = async () => {}; const initFirebase = () => {};

// Init immediately
initFirebase(); 

/* ========== Lid overrides (file-based) ========== */
let lidOverrides = {};
const phoneToLidMap = new Map();

function loadLidOverrides() {
  try {
    if (fs.existsSync(LID_MAPPING_FILE)) {
      const raw = fs.readFileSync(LID_MAPPING_FILE, "utf8");
      lidOverrides = raw ? JSON.parse(raw) : {};
    } else {
      lidOverrides = {};
    }
  } catch (e) {
    console.error("Failed to load lid_mappings.json:", e);
    lidOverrides = {};
  }
  phoneToLidMap.clear();
  for (const [lid, phoneJid] of Object.entries(lidOverrides)) {
    phoneToLidMap.set(phoneJid, lid);
  }
}
function saveLidOverrides() {
  try {
    fs.writeFileSync(LID_MAPPING_FILE, JSON.stringify(lidOverrides, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to write lid_mappings.json:", e);
  }
  phoneToLidMap.clear();
  for (const [lid, phoneJid] of Object.entries(lidOverrides)) {
    phoneToLidMap.set(phoneJid, lid);
  }
}
loadLidOverrides();

/* ========== Store setup ========== */
const store = makeCustomStore();
if (fs.existsSync(STORE_FILE)) {
  try { store.readFromFile(STORE_FILE); } catch (e) { console.error("Failed to read store:", e); }
}

/* Debounced writes */
let pendingWrite = null;
function scheduleStoreWrite(delay = 2000) {
  if (pendingWrite) return;
  pendingWrite = setTimeout(() => {
    try {
      store.writeToFile(STORE_FILE);
    } catch (e) {
      console.error("store.writeToFile error:", e);
    } finally {
      clearTimeout(pendingWrite);
      pendingWrite = null;
    }
  }, delay);
}
setInterval(() => { try { store.writeToFile(STORE_FILE); } catch (e) {} }, 10000);

/* ========== Google Sync Init ========== */
// import googleSync from "./google-sync.js"; // Removed duplicate
// googleSync.initGoogleSync().catch(e => console.error("Failed to init Google Sync:", e));

/* ========== Session Manager ========== */
const sessionManager = new SessionManager(store);
// Start initialization
sessionManager.init().catch(err => console.error("Failed to init SessionManager:", err));


/* ========== Helpers to access store (Map or Object) ========== */
function getContact(id) {
  if (!store || !store.contacts) return null;
  if (store.contacts instanceof Map) return store.contacts.get(id);
  return store.contacts[id];
}
function setContact(id, value) {
  if (store.contacts instanceof Map) store.contacts.set(id, value);
  else store.contacts[id] = value;
}
function getAllContactsArray() {
  if (!store || !store.contacts) return [];
  if (store.contacts instanceof Map) return Array.from(store.contacts.values());
  return Object.values(store.contacts);
}
function getMessagesForJid(jid) {
  if (!store || !store.messages) return [];
  if (store.messages instanceof Map) return store.messages.get(jid) || [];
  return store.messages[jid] || [];
}
function getChatsArray() {
  if (!store || !store.chats) return [];
  if (store.chats instanceof Map) return Array.from(store.chats.values());
  return Object.values(store.chats);
}

/* ========== Canonicalization logic ========== */
function resolveCanonicalJid(jid) {
  if (!jid) return jid;
  if (jid.endsWith("@g.us")) return jid; // groups keep their own id

  const suffix = jid.split("@")[1] || "";

  if (suffix === "s.whatsapp.net" || suffix === "c.us") {
    return jid;
  }

  if (suffix === "lid") {
    const contact = getContact(jid);
    if (contact && contact.phoneNumber) return contact.phoneNumber;
    if (lidOverrides[jid]) return lidOverrides[jid];
    const contacts = getAllContactsArray();
    for (const c of contacts) {
      if (!c) continue;
      if (c.id === jid && c.phoneNumber) return c.phoneNumber;
    }
    for (const c of contacts) {
      if (!c) continue;
      if (c.lid && c.lid === jid && c.phoneNumber) return c.phoneNumber;
    }
    for (const c of contacts) {
      if (!c) continue;
      if (c.phoneNumber && typeof c.phoneNumber === "string") {
        const candidatePhone = c.phoneNumber.split("@")[0];
        const lidNumeric = jid.split("@")[0];
        if (String(candidatePhone).includes(String(lidNumeric).slice(-6)) ) {
          return c.phoneNumber;
        }
      }
    }
    for (const [k, v] of Object.entries(lidOverrides)) {
      if (k === jid) return v;
    }
    return jid;
  }

  const c = getContact(jid);
  if (c && c.phoneNumber) return c.phoneNumber;
  const phonePart = jid.split("@")[0];
  for (const contact of getAllContactsArray()) {
    if (!contact) continue;
    if (contact.phoneNumber && contact.phoneNumber.split("@")[0] === phonePart) return contact.phoneNumber;
    if (contact.id && contact.id.split("@")[0] === phonePart) return contact.id;
  }
  return jid;
}

/* ========== JID Resolution Helpers ========== */
function findPartnerJids(target) {
  const partners = new Set();
  partners.add(target);

  // canonical
  try {
    const canonical = resolveCanonicalJid(target);
    if (canonical) partners.add(canonical);
  } catch (e) {}

  // dacă target e phone, adaugă lid-urile care au phoneNumber
  if (target.endsWith('@s.whatsapp.net')) {
    const contacts = store.contacts instanceof Map ? Array.from(store.contacts.values()) : Object.values(store.contacts || {});
    for (const c of contacts) {
      if (!c) continue;
      if (c.phoneNumber === target) partners.add(c.id);
      if (c.id && c.id.endsWith('@lid') && c.phoneNumber === target) partners.add(c.id);
    }
    // și mapping file
    for (const [lid, phone] of Object.entries(lidOverrides || {})) {
      if (phone === target) partners.add(lid);
    }
  }

  // dacă target e lid, adaugă phone din contact sau din lidOverrides
  if (target.endsWith('@lid')) {
    const contact = store.contacts instanceof Map ? store.contacts.get(target) : (store.contacts || {})[target];
    if (contact && contact.phoneNumber) partners.add(contact.phoneNumber);
    if (lidOverrides && lidOverrides[target]) partners.add(lidOverrides[target]);
  }

  return Array.from(partners);
}


// import googleSync from "./google-sync.js";

/* ========== Express app ========== */
const app = express();
app.use(cors());
app.use(express.json());
app.use('/media', express.static(path.join(process.cwd(), 'public', 'media')));
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

/* ========== Twilio Config — FAIL-FAST, NO HARDCODED FALLBACKS ========== */
const TWILIO_SID     = process.env.TWILIO_SID;
const TWILIO_TOKEN   = process.env.TWILIO_TOKEN;
const API_KEY_SID    = process.env.TWILIO_API_KEY_SID;
const API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET;
const TWIML_APP_SID  = process.env.TWIML_APP_SID;
if (!TWILIO_SID || !TWILIO_TOKEN) {
  console.error('[FATAL] TWILIO_SID and TWILIO_TOKEN are required — server cannot function without Twilio credentials');
  process.exit(1);
}
const twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);

/* ========== Twilio Webhook ========== */
// Add urlencoded for Twilio
app.use(express.urlencoded({ extended: true }));


// ─── Security: require Firebase ID token for all /api/* routes ──────────────
// /health is excluded (it's before this middleware)
app.use('/api', (req, res, next) => {
  // Twilio webhooks and WS token cannot send Bearer tokens — exempt them
  const exempt = [
    '/auth/get-ws-token',
    '/voice/incoming',
    '/voice/status',
    '/voice/dial-status',
    '/voice/recording-status',
    '/voice/callback-connect',
    '/voice/bridge-agent',
    '/wa/send-direct',        // internal-only, protected by WA_INTERNAL_TOKEN
  ];
  if (exempt.some(p => req.path === p || req.path.startsWith(p))) return next();
  return requireFirebaseAuth(req, res, next);
});

app.post('/api/voice/incoming', async (req, res) => {
  const { From, To, CallSid } = req.body;
  console.log(`[Twilio] Incoming Voice Request. From: ${From}, To: ${To}, SID: ${CallSid}`);
  
  // 1. Log to Firestore
  // 1. Log to Firestore
  try {
    if (From && To && CallSid) {
      await db.collection('calls').doc(CallSid).set({
        callSid: CallSid,
        from: From,
        to: To,
        direction: (From.startsWith('client:') || !From.startsWith('+')) ? 'outgoing' : 'incoming',
        status: 'ringing',
        timestamp: new Date(),
        noticePlayed: true
      }, { merge: true });
    }
  } catch(e) { console.error('Error logging call:', e); }

  const twiml = new twilio.twiml.VoiceResponse();
  const BASE_URL = process.env.PUBLIC_URL || 'https://voice.superparty.ro';

  // 3. Routing Logic
  // Outbound: From starts with 'client:', OR is a known SDK identity (no '+' prefix = not a phone number)
  const isOutbound = From && (From.startsWith('client:') || !From.startsWith('+'));
  if (isOutbound) {
      // OUTGOING CALL (From Mobile App -> To external number)
      // NOTE: NO compliance message here — it causes the SDK session to timeout before connecting
      console.log(`[Twilio] Handling Outgoing Call from App (${From}) to: ${To}`);

      const CALLER_ID = process.env.TWILIO_CALLER_ID || process.env.TWILIO_PHONE_NUMBER;

      if (!To || To.includes('centrala')) {
          twiml.say({ language: 'ro-RO' }, 'Ați sunat la Centrală. Testul de apel este reușit. O zi bună!');
      } else if (To.startsWith('bridge_')) {
          const targetCallSid = To.split('_')[1];
          console.log(`[Twilio] Agent bridging into conference for parked call: ${targetCallSid}`);
          
          const dial = twiml.dial();
          dial.conference({
            beep: false,
            startConferenceOnEnter: true,
            endConferenceOnExit: true
          }, targetCallSid);
          
          // Also mark the firestore document as answered
          try {
             db.collection('active_incoming_calls').doc(targetCallSid).update({
               status: 'answered',
               answeredBy: From
             }).catch(e => console.error('Firestore bridge update error:', e));
          } catch(e) {}
      } else {
          let target = To;
          // Clean target completely to digits-only
          let digitsOnly = target.replace(/\D/g, '');
          
          if (digitsOnly.startsWith('07')) {
             target = '+4' + digitsOnly;
          } else if (digitsOnly.startsWith('40') || digitsOnly.startsWith('44') || digitsOnly.startsWith('39')) {
             // Basic international handling for RO/UK/IT
             target = '+' + digitsOnly;
          } else if (digitsOnly.length >= 10) {
             // Fallback default
             target = '+' + digitsOnly;
          }

          if (target.length > 9) {
             console.log(`[Twilio] Dialing external number: ${target} executed by ${From}`);
             const dial = twiml.dial({
               callerId: CALLER_ID,
               record: 'record-from-answer',
               recordingStatusCallback: `${BASE_URL}/api/voice/recording-status`,
               recordingStatusCallbackMethod: 'POST',
               timeout: 30,
               // NOTE: no `action` URL — returning non-TwiML from action causes immediate hangup
             });
             dial.number(target);
          } else {
             twiml.say({ language: 'ro-RO' }, 'Numărul format este incorect.');
          }
      }
  } else {
      // INCOMING CALL (From World -> To Mobile App)
      console.log(`[Twilio] Handling Incoming Call to App`);
      
      twiml.say({ language: 'ro-RO' }, 'Ați sunat la Super Party animatori petreceri copii. În câteva momente apelul dumneavoastră va fi preluat de un operator.');

      // Instead of bridging directly via <Client> (which fails due to missing Push Credential),
      // we park the call in a Twilio Conference or Enqueue, and alert Flutter via Firestore.
      
      try {
         await db.collection('active_incoming_calls').doc(CallSid).set({
           callSid: CallSid,
           from: From,
           to: To,
           status: 'ringing',
           timestamp: new Date()
         });
         console.log(`[VoIP] Alerted active_incoming_calls table for Flutter polling. SID: ${CallSid}`);
       // Notify all connected VoIP WS clients (foreground Flutter → ring UI)
       notifyVoipClients({
         type: 'incoming_call',
         callSid: CallSid,
         conf: CallSid,
         callerNumber: From,
         from: From,
         to: To,
         sig: '',
         expires: String(Math.floor(Date.now()/1000) + 30),
       });
      } catch(e) { console.error('[VoIP] Error alerting Firestore:', e); }

      // Park the caller into a conference queue named after their CallSid
      const dial = twiml.dial({
        callerId: From,
        answerOnBridge: true,
        timeout: 60,
        record: 'record-from-answer',
        recordingStatusCallback: `${BASE_URL}/api/voice/recording-status`,
        recordingStatusCallbackMethod: 'POST',
        action: `${BASE_URL}/api/voice/dial-status`
      });
      dial.conference({
        beep: 'false',
        waitUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical',
        startConferenceOnEnter: true,
        endConferenceOnExit: true
      }, CallSid); // The conference name is the Caller's SID
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// ─── AGENT BRIDGE: Flutter app calls this when the user presses Answer ─────────
app.post('/api/voice/bridge-agent', async (req, res) => {
  try {
    const { callSid, agentIdentity, fcmToken } = req.body;
    if (!callSid || !agentIdentity) return res.status(400).json({ error: 'Missing callSid or agentIdentity' });

    console.log(`[VoIP Bridge] Agent ${agentIdentity} answering CallSid: ${callSid}`);
    
    // Create an OUTBOUND call from Twilio to the Agent's Twilio Client Identity
    // When the agent answers implicitly, Twilio drops them into the SAME conference as the caller
    const BASE_URL = process.env.PUBLIC_URL || 'https://voice.superparty.ro';
    
    const call = await twilioClient.calls.create({
      to: `client:${agentIdentity}`,
      from: process.env.TWILIO_CALLER_ID || process.env.TWILIO_PHONE_NUMBER, // from env
      twiml: `<Response><Dial><Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="true">${callSid}</Conference></Dial></Response>`,
    });

    // Mark Firestore as answered
    await db.collection('active_incoming_calls').doc(callSid).update({
       status: 'answered',
       answeredBy: agentIdentity
    });

    res.json({ success: true, agentCallSid: call.sid });
  } catch (error) {
    console.error(`[VoIP Bridge] Error bridging agent:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/voice/dial-status', (req, res) => {
  console.log("[Twilio] Dial Status:", req.body.DialCallStatus, "CallSid:", req.body.CallSid);
  res.sendStatus(200);
});

// ─── FORCE HANGUP FLUTTER ──────────────────────────────
app.post('/api/voice/cancel', async (req, res) => {
  try {
    const { callSid } = req.body;
    if (!callSid) return res.status(400).json({ error: 'Missing callSid' });

    console.log(`[VoIP] Force-canceling CallSid: ${callSid} requested by app...`);
    const call = await twilioClient.calls(callSid).update({ status: 'completed' });
    console.log(`[VoIP] Call ${callSid} successfully terminated to state: ${call.status}`);
    res.json({ success: true, status: call.status });
  } catch (error) {
    console.error(`[VoIP] Error force-canceling call ${req.body.callSid}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── REST Callback: apelează clientul via Twilio REST API (bypass SDK) ──────────
// Flutter apasă butonul → backend sună clientul → când răspunde, bridgem agentul
app.post('/api/voice/callback', async (req, res) => {
  try {
    const { to, agentIdentity } = req.body;
    if (!to) return res.status(400).json({ error: 'Missing `to` phone number' });

    const CALLER_ID = process.env.TWILIO_CALLER_ID;
    const BASE_URL  = process.env.PUBLIC_URL || 'https://voice.superparty.ro';

    // Fetch the agent identity from Firestore if not provided
    let identity = agentIdentity;
    if (!identity) {
      const snap = await db.collectionGroup('devices').limit(1).get();
      identity = snap.docs[0]?.data()?.identity || 'superparty_admin';
    }

    console.log(`[Callback] REST call: ${CALLER_ID} → ${to}, bridging to agent: ${identity}`);

    // Use Twilio REST API to call the client
    // TwiML: when client answers → dial the agent's VoIP client (INCOMING call to app)
    const clientNumberRaw = to;
      const clientNumber = normalizeToE164(clientNumberRaw, 'RO');
      const twimlUrl = `${BASE_URL}/api/voice/callback-connect?identity=${encodeURIComponent(identity)}&to=${encodeURIComponent(clientNumber)}`;
      const call = await twilioClient.calls.create({
        to: clientNumber,
        from: CALLER_ID,
        url: twimlUrl,
      statusCallback: `${BASE_URL}/api/voice/status`,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed', 'no-answer', 'busy', 'failed'],
    });

    console.log(`[Callback] Call created: ${call.sid}, status: ${call.status}`);

    // Log to Firestore using the CallSid as document ID to match status webhooks
    await db.collection('calls').doc(call.sid).set({
      from:      CALLER_ID,
      to: clientNumber,
      direction: 'outgoing',
      status:    'ringing',
      callSid:   call.sid,
      timestamp: new Date(),
    });

    res.json({ success: true, callSid: call.sid });
  } catch (e) {
    console.error('[Callback] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// TwiML served when client answers the REST callback call
// Bridges the client to the agent's VoIP identity (agent receives INCOMING call in app)
app.all('/api/voice/callback-connect', (req, res) => {
  // identity can be in query (GET) or body (POST — Twilio uses POST)
  const identity = req.query.identity || req.body?.identity || 'superparty_admin';
  // 'to' is the client's number, we use it as callerId so the agent knows who is calling
  const to = req.query.to || req.body?.to || req.body?.To;
  
  console.log(`[CallbackConnect] Bridging call to agent identity: ${identity}, callerId: ${to}`);
  const twiml = new twilio.twiml.VoiceResponse();
  // No compliance message here — just bridge directly to avoid delay
  const dial = twiml.dial({ timeout: 30, callerId: to });
  dial.client(identity);
  res.type('text/xml');
  res.send(twiml.toString());
});


// ── Call Log: Cancel an outgoing REST call and its bridged child legs ──────────
app.delete('/api/voice/callback/:sid', async (req, res) => {
  try {
    const parentSid = req.params.sid;
    console.log(`[Callback] Canceling parent call: ${parentSid}`);
    
    // 1. Cancel the main parent leg (client's GSM phone)
    const call = await twilioClient.calls(parentSid).update({ status: 'canceled' });
    
    // 2. Fetch and cancel any associated child legs (e.g. the bridged VoIP leg to the agent)
    // Twilio creates child calls when using <Dial> or REST bridging.
    const childCalls = await twilioClient.calls.list({
      parentCallSid: parentSid,
      status: 'ringing' // Only cancel if it's currently ringing/in-progress
    });
    const childCallsInProgress = await twilioClient.calls.list({
      parentCallSid: parentSid,
      status: 'in-progress'
    });
    
    const activeChildren = [...childCalls, ...childCallsInProgress];
    
    for (const child of activeChildren) {
      console.log(`[Callback] Canceling child leg: ${child.sid} (status: ${child.status})`);
      try {
        await twilioClient.calls(child.sid).update({ status: 'canceled' });
      } catch (childErr) {
        console.error(`[Callback] Failed to cancel child ${child.sid}:`, childErr.message);
      }
    }

    // 3. Update Firestore
    await db.collection('calls').doc(parentSid).set({
      status: 'canceled',
      endTime: new Date(),
    }, { merge: true });

    res.json({ success: true, callSid: call.sid, status: call.status, canceledChildren: activeChildren.length });
  } catch (e) {
    if (e.status === 400 || e.message.includes("not in-progress")) {
      console.log(`[Callback] Call ${req.params.sid} already ended.`);
      res.json({ success: true, message: 'Already ended' });
    } else {
      console.error(`[Callback] Error canceling call ${req.params.sid}:`, e.message);
      res.status(500).json({ error: e.message });
    }
  }
});



// ── Call Log: Save every inbound call to Firestore ────────────────────────────


// POST /api/voice/call-client — PII isolation: backend resolves phone from conversationId
app.post('/api/voice/call-client', requireFirebaseAuth, async (req, res) => {
  const { conversationId } = req.body || {};
  if (!conversationId) return res.status(400).json({ error: 'conversationId required' });
  try {
    const { data: conv, error } = await supabase
      .from('conversations')
      .select('phone, jid, account_id')
      .eq('id', conversationId)
      .single();
    if (error || !conv) return res.status(404).json({ error: 'Conversation not found' });
    let to = conv.phone;
    if (!to && conv.jid) {
      const local = conv.jid.split('@')[0];
      if (/^d+$/.test(local)) to = '+' + local;
    }
    if (!to) return res.status(422).json({ error: 'Cannot resolve phone for conversation' });
    const twilioSid = process.env.TWILIO_SID || process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN || process.env.TWILIO_TOKEN;
    const callerNumber = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_CALLER_ID;
    if (!twilioSid || !twilioToken) return res.status(503).json({ error: 'Twilio not configured' });
    const { default: twilio } = await import('twilio');
    const client = twilio(twilioSid, twilioToken);
    const call = await client.calls.create({
      to,
      from: callerNumber,
      url: process.env.BASE_URL + '/api/voice/callback-connect?to=' + encodeURIComponent(to),
      statusCallback: process.env.BASE_URL + '/api/voice/status',
      statusCallbackMethod: 'POST',
    });
    console.log('[voice/call-client] Call initiated', call.sid, 'to', to.slice(0,4) + '****');
    res.json({ callSid: call.sid, status: 'initiated' });
  } catch (e) {
    console.error('[voice/call-client] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/voice/status', async (req, res) => {
  const { CallSid, CallStatus, From, To, CallDuration, StartTime, EndTime } = req.body;
  console.log(`[Twilio] Call Status: ${CallStatus} SID:${CallSid} From:${From} Duration:${CallDuration}s`);
  try {
    const cleanFrom = (From || '').replace('client:', '').replace('+', '');
    await db.collection('calls').doc(CallSid).set({
      callSid: CallSid,
      from: From || '',
      fromClean: cleanFrom,
      to: To || '',
      status: CallStatus || '',
      duration: parseInt(CallDuration || '0', 10),
      startTime: StartTime ? new Date(StartTime) : new Date(),
      endTime: EndTime ? new Date(EndTime) : null,
      timestamp: new Date(),
    }, { merge: true });
    console.log(`[CallLog] Saved call ${CallSid} to Firestore`);
  } catch (e) {
    console.error('[CallLog] Failed to save call log:', e.message);
  }

  // ── CRITICAL FIX: notify Flutter via WS on caller hangup / call end ──────
  // Twilio sends this callback for ALL terminal statuses including canceled (caller hangup before answer)
  const TERMINAL = ['completed', 'no-answer', 'busy', 'failed', 'canceled'];
  if (TERMINAL.includes(CallStatus)) {
    console.log(`[VoIP Status] Terminal status '${CallStatus}' for ${CallSid} — notifying WS + cleaning Firestore`);

    // 1. Notify all connected Flutter WS clients → triggers clearStaleIncomingUi()
    notifyVoipClients({
      type: 'call_ended',
      callSid: CallSid,
      status: CallStatus,
      from: From || '',
      to: To || '',
    });

    // 2. Delete active_incoming_calls document so Firestore stays clean
    try {
      await db.collection('active_incoming_calls').doc(CallSid).delete();
      console.log(`[VoIP Status] Deleted active_incoming_calls/${CallSid}`);
    } catch (e) {
      // May not exist (e.g. outbound call) — safe to ignore
      console.log(`[VoIP Status] active_incoming_calls/${CallSid} not found (non-fatal)`);
    }
  }

  res.sendStatus(200);
});

// ── Recording Status: Save recording URL when Twilio finishes ────────────────
app.post('/api/voice/recording-status', async (req, res) => {
  const { CallSid, RecordingSid, RecordingUrl, RecordingDuration, RecordingStatus } = req.body;
  console.log(`[Recording] SID:${RecordingSid} CallSid:${CallSid} Status:${RecordingStatus} Duration:${RecordingDuration}s`);
  if (RecordingStatus === 'completed' && CallSid && RecordingUrl) {
    try {
      const url = `${RecordingUrl}.mp3`; // Force MP3 format
      await db.collection('calls').doc(CallSid).set({
        recordingUrl: url,
        recordingSid: RecordingSid,
        recordingDuration: parseInt(RecordingDuration || '0', 10),
      }, { merge: true });
      console.log(`[Recording] Saved recording URL for call ${CallSid}`);
    } catch (e) {
      console.error('[Recording] Failed to save recording URL:', e.message);
    }
  }
  res.sendStatus(200);
});

// ── GET Call History ──────────────────────────────────────────────────────────
app.get('/api/voice/calls', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const snap = await db.collection('calls')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
    const calls = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Convert Firestore Timestamps to ISO strings for JSON
    const serialized = calls.map(c => ({
      ...c,
      startTime: c.startTime?.toDate?.()?.toISOString?.() ?? c.startTime,
      endTime: c.endTime?.toDate?.()?.toISOString?.() ?? c.endTime,
      timestamp: c.timestamp?.toDate?.()?.toISOString?.() ?? c.timestamp,
    }));
    res.json({ calls: serialized });
  } catch (e) {
    console.error('[GetCalls] Error fetching calls:', e.message);
    res.status(500).json({ error: e.message });
  }
});


// ── GET /api/voice/calls/recent — recent calls list
// Reads from Firestore db.collection('calls') — same source as /api/voice/calls
// Supabase 'calls' table is separate (different schema) and currently empty
app.get('/api/voice/calls/recent', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    // Primary: Firestore calls collection (same as /api/voice/calls)
    const snap = await db.collection('calls')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
    const calls = snap.docs.map(d => {
      const c = { id: d.id, ...d.data() };
      return {
        id: c.id,
        callSid: c.CallSid || c.callSid || c.id,
        direction: c.direction || c.Direction,
        from: c.from || c.From || c.callerNumber || '',
        to: c.to || c.To || c.calledNumber || '',
        status: c.status || c.CallStatus || c.Status,
        duration: c.duration || c.Duration || c.CallDuration || 0,
        timestamp: c.timestamp?.toDate?.()?.toISOString?.() ?? c.timestamp ?? null,
        startTime: c.startTime?.toDate?.()?.toISOString?.() ?? c.startTime ?? null,
        endTime: c.endTime?.toDate?.()?.toISOString?.() ?? c.endTime ?? null,
        recordingUrl: c.recordingUrl || c.RecordingUrl || null,
        conversationId: c.conversationId || c.conversation_id || null,
        contact_name: c.contactName || c.contact_name || c.callerName || null,
      };
    });
    res.json({ calls });
  } catch (e) {
    console.error('[voice/calls/recent] Firestore error:', e.message);
    res.status(500).json({ error: e.message, detail: 'Firestore read failed' });
  }
});

// ── Call Log: Fetch single call by SID ────────────────────────────────────────
app.get('/api/voice/calls/:sid', async (req, res) => {
  try {
    const sid = req.params.sid;
    const doc = await db.collection('calls').doc(sid).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Call not found' });
    }
    const data = doc.data();
    res.json({
      id: doc.id,
      ...data,
      startTime: data.startTime ? data.startTime.toDate().toISOString() : null,
      endTime: data.endTime ? data.endTime.toDate().toISOString() : null,
      timestamp: data.timestamp ? data.timestamp.toDate().toISOString() : null,
    });
  } catch (e) {
    console.error(`[GetCall] Error fetching call ${req.params.sid}:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Recording Proxy: streams Twilio recording with Basic Auth ─────────────────
// Flutter cannot add Basic Auth headers to url_launcher — proxy it here.
app.get('/api/voice/recording/:sid', async (req, res) => {
  const { sid } = req.params;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Recordings/${sid}.mp3`;
  try {
    const fetch = (await import('node-fetch')).default;
    const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
    const response = await fetch(url, {
      headers: { 'Authorization': `Basic ${auth}` }
    });
    if (!response.ok) {
      console.error(`[Recording] Twilio returned ${response.status} for ${sid}`);
      return res.status(response.status).send('Recording not available');
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `inline; filename="${sid}.mp3"`);
    response.body.pipe(res);
  } catch (e) {
    console.error('[Recording] Proxy error:', e.message);
    res.status(500).send('Proxy error');
  }
});

// MULTI-DEVICE: Register a specific device hardware ID and its FCM Token
app.post('/api/voice/registerDevice', async (req, res) => {
  const { userId, deviceId, fcmToken } = req.body;
  if (!userId || !deviceId || !fcmToken) {
    return res.status(400).send('Missing required fields: userId, deviceId, fcmToken');
  }

  const identity = `user_${userId}_dev_${deviceId}`;
  try {
    await db.collection('users').doc(userId)
      .collection('devices').doc(deviceId)
      .set({ 
        identity, 
        fcmToken, 
        lastSeen: new Date() 
      }, { merge: true });
    
    console.log(`[Twilio VoIP] Registered device ${deviceId} for user ${userId} with identity: ${identity}`);
    res.json({ identity });
  } catch (error) {
    console.error("[Twilio VoIP] Error registering device:", error);
    res.status(500).send('Internal Server Error');
  }
});

// MULTI-DEVICE: Fetch token scoped to a specific device identity
app.get('/api/voice/getVoipToken', async (req, res) => {
  const { userId, deviceId } = req.query;
  if (!userId || !deviceId) {
    return res.status(400).send('Missing required query params: userId, deviceId');
  }
  
  try {
    const deviceDoc = await db.collection('users').doc(userId)
      .collection('devices').doc(deviceId).get();

    if (!deviceDoc.exists) {
      return res.status(404).send('device-not-registered');
    }

    const identity = deviceDoc.data().identity;
    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: TWIML_APP_SID,
      incomingAllow: true, // Allow incoming calls
    });

    const token = new AccessToken(
      TWILIO_SID,
      API_KEY_SID,
      API_KEY_SECRET,
      { identity: identity }
    );
    
    // PUSH CREDENTIAL: from env only — no hardcoded fallback
    const PUSH_CREDENTIAL_SID = process.env.TWILIO_PUSH_CREDENTIAL_SID;
    if (!PUSH_CREDENTIAL_SID) {
      console.warn('[VoIP] TWILIO_PUSH_CREDENTIAL_SID not set — push notifications disabled for this token');
    } else {
      voiceGrant.pushCredentialSid = PUSH_CREDENTIAL_SID;
    }

    token.addGrant(voiceGrant);

    res.json({ token: token.toJwt(), identity });
  } catch (error) {
    console.error("[Twilio VoIP] Error generating VoIP token:", error);
    res.status(500).send('Internal Server Error');
  }
});

// Status Callback for VoIP - Handles Multi-Device Drop when one answers or client hangs up
app.post('/api/voice/client-status', async (req, res) => {
  const { CallStatus, CallSid, Called } = req.body;
  console.log(`[Twilio VoIP] Client Status Update: ${CallStatus} for CallSid: ${CallSid} (Client: ${Called})`);

  // If the call was canceled, rejected, or completed on this specific client
  const terminalStates = [];
  if (terminalStates.includes(CallStatus) && Called && Called.startsWith('client:user_')) {
    const identityString = Called.replace('client:', '');
    
    // Identity format: user_{userId}_dev_{deviceId}
    const parts = identityString.split('_');
    if (parts.length >= 4) {
      const userId = parts[1];
      const deviceId = parts[3];

      try {
        const deviceDoc = await db.collection('users').doc(userId).collection('devices').doc(deviceId).get();
        if (deviceDoc.exists && deviceDoc.data().fcmToken) {
          const fcmToken = deviceDoc.data().fcmToken;
          
          console.log(`[Twilio VoIP] Sending explicit CANCEL signal via FCM to device ${deviceId} (Identity: ${identityString})`);
          
          // We send a custom data payload that our Kotlin CustomVoiceFirebaseMessagingService will intercept
          const message = {
            token: fcmToken,
            android: { priority: 'high' },
            data: {
              target_action: 'CANCEL_RINGING_UI',
              twi_call_sid: CallSid
            }
          };
          
          await admin.messaging().send(message);
          console.log(`[Twilio VoIP] CANCEL signal fired to FCM successfully.`);
        }
      } catch (err) {
        console.error(`[Twilio VoIP] Failed to send CANCEL FCM to device ${deviceId}:`, err);
      }
    }
  }

  res.sendStatus(200);
});

// ─── Remote VoIP Diagnostics ───────────────────────────────────────────────
// POST  /api/voice/diag          — receive diagnostic payload from Flutter app
// GET   /api/voice/diag/latest   — read last N reports (dev tool)
const _voipDiagReports = [];  // in-memory, last 20 reports

function _analyzeTimeline(timeline, report) {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return { verdict: 'NO_TIMELINE', detail: 'Zero events — diag trimis fără events VoIP (probabil fără apel).' };
  }
  const tags = timeline.map(e => e.tag);
  const evts = timeline.map(e => e.msg);
  const has = (t) => tags.includes(t) || evts.some(m => m && m.includes(t));

  const hasInvite    = has('INVITE') || has('INCOMING') || has('onCallInvite');
  const hasAccept    = has('ACCEPT_TAPPED') || has('ACCEPT');
  const hasAnswerTrue = timeline.some(e => e.tag === 'ANSWER' && e.data?.result === true);
  const hasAnswerFalse = timeline.some(e => e.tag === 'ANSWER') && !hasAnswerTrue;
  const hasConnected = has('CONNECTED');
  const hasAuthErr   = has('AUTH_ERROR') || (report.network?.lastAuthError);
  const lastCallSid  = report.voip?.lastCallSid || null;

  const lines = [];
  lines.push(`=== AUTO-VERDICT ===`);
  lines.push(`INVITE: ${hasInvite}, ACCEPT: ${hasAccept}, ANSWER_TRUE: ${hasAnswerTrue}, CONNECTED: ${hasConnected}`);
  lines.push(`AUTH_ERR: ${hasAuthErr ? report.network?.lastAuthError || 'yes' : 'no'}, CallSid: ${lastCallSid || 'unknown'}`);

  // AUTH_ERROR → warning (separate from main verdict, doesn't override it)
  const warnings = [];
  if (hasAuthErr) {
    warnings.push(`WARN: AUTH_ERROR: ${report.network?.lastAuthError || 'yes'} — testele VoIP pot fi neconcludente.`);
  }

  let verdict, detail;

  if (!hasInvite) {
    verdict = 'FAIL: NO_INVITE';
    detail = 'Twilio push/notification nu a ajuns la app (FCM delivery, credential, binding invalid).';
  } else if (!hasAccept) {
    verdict = 'FAIL: ACCEPT_MISSING';
    detail = 'Invite a ajuns dar butonul Accept nu a livrat evenimentul în Flutter (bridge IncomingCallActivity → Flutter rupt).';
  } else if (hasAnswerFalse) {
    verdict = 'FAIL: ANSWER_FALSE';
    detail = 'accept() trimis dar answer() eșuat (PhoneAccount neregistrat, READ_PHONE_* lipsă, timing).';
  } else if (!hasAnswerTrue) {
    verdict = 'FAIL: NO_ANSWER_EVENT';
    detail = 'ACCEPT_TAPPED apare dar niciun ANSWER event în timeline — handlerul answerCall nu a rulat.';
  } else if (hasAnswerTrue && !hasConnected) {
    verdict = 'FAIL: NO_CONNECTED';
    detail = 'answer()=true dar CallEvent.connected lipsește — semnal Twilio nu ajunge înapoi (rețea/ICE/timing).';
  } else if (hasAnswerTrue && hasConnected) {
    verdict = 'SUSPECT: TWILIO_BRIDGE_OR_MEDIA';
    detail = `Connected în app dar remote poate auzi ring = media nu e bridged. Verifică Twilio Inspector CallSid=${lastCallSid || '?'}: "Client answered" + ICE events.`;
  } else {
    verdict = 'UNKNOWN';
    detail = 'Timeline neașteptat — trimite JSON complet.';
  }

  lines.push(`VERDICT: ${verdict}`);
  lines.push(`DETAIL: ${detail}`);
  return { verdict, detail, lines, warnings };
}

app.post('/api/voice/diag', (req, res) => {
  try {
    const report = { receivedAt: new Date().toISOString(), ...req.body };
    _voipDiagReports.unshift(report);
    if (_voipDiagReports.length > 20) _voipDiagReports.pop();

    const eventCount = Array.isArray(report.timeline) ? report.timeline.length : 0;
    console.log(`\n[VoipDiag] ✅ Report from=${report.user} build=${report.build} events=${eventCount}`);
    console.log(`  permissions: mic=${report.permissions?.mic} notif=${report.permissions?.notif} phone=${report.permissions?.phone} battery=${report.permissions?.battery}`);
    console.log(`  voipRegistered=${report.voipRegistered} fcmHash=${report.fcmHash}`);

    // Notification channel info
    if (report.channelInfo) {
      console.log(`  channel: importance=${report.channelInfo.importance} sound=${report.channelInfo.sound} userSet=${report.channelInfo.userSet}`);
    }
    if (report.dndOff !== undefined) console.log(`  DND off=${report.dndOff}`);
    if (report.network?.lastAuthError) console.log(`  ⚠️ AUTH_ERROR: ${report.network.lastAuthError}`);

    // Timeline summary
    if (Array.isArray(report.timeline) && report.timeline.length > 0) {
      console.log('  Timeline:');
      report.timeline.slice(0, 40).forEach(e =>
        console.log(`    [${e.ts?.substring(11,19)}] [${e.tag}] ${e.msg}${e.data ? ' ' + JSON.stringify(e.data) : ''}`)
      );
    }

    // Auto-verdict
    const analysis = _analyzeTimeline(report.timeline, report);
    analysis.lines?.forEach(l => console.log(`  ${l}`));
    report._verdict = analysis.verdict;
    report._detail  = analysis.detail;

    res.json({ ok: true, received: eventCount, verdict: analysis.verdict, detail: analysis.detail, warnings: analysis.warnings || [] });
  } catch (e) {
    console.error('[VoipDiag] Error:', e);
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/voice/diag/latest', (req, res) => {
  const n = Math.min(parseInt(req.query.n) || 3, 20);
  const reports = _voipDiagReports.slice(0, n).map(r => ({
    receivedAt:    r.receivedAt,
    build:         r.build,
    user:          r.user,
    voipRegistered: r.voipRegistered,
    permissions:   r.permissions,
    channelInfo:   r.channelInfo,
    dndOff:        r.dndOff,
    network:       r.network,
    fcmHash:       r.fcmHash,
    _verdict:      r._verdict,
    _detail:       r._detail,
    timeline:      r.timeline,
  }));
  res.json({ reports });
});


// ─── DEV/TEST: Simulate incoming VoIP push ──────────────────────────────────
// Usage: POST /api/voice/simulate_push { "fcmToken": "...", "callSid": "CA_TEST" }
// Remove or gate behind auth before going to production.
app.post('/api/voice/simulate_push', async (req, res) => {
  const { fcmToken, callSid = 'CA_SIMULATED_0000000001' } = req.body;
  if (!fcmToken) return res.status(400).json({ error: 'fcmToken is required' });
  try {
    const message = {
      token: fcmToken,
      android: { priority: 'high' },
      data: {
        twi_message_type: 'twilio.voice.call',
        twi_call_sid: callSid,
        message: '[DiagTest] Simulated incoming call',
      },
    };
    const result = await admin.messaging().send(message);
    console.log('[SimulatePush] Sent FCM message:', result);
    res.json({ ok: true, result });
  } catch (e) {
    console.error('[SimulatePush] Error:', e);
    res.status(500).json({ error: e.message });
  }
});


app.all('/DEBUG_TEST', (req, res) => {
  res.send(`DEBUG: Running index.js in ${process.cwd()}`);
});

// DEBUG: Trigger profile pic backfill
app.get('/debug/fetch-avatars/:docId', async (req, res) => {
  const { docId } = req.params;
  try {
    const result = await sessionManager.backfillProfilePictures(docId);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DEBUG: Trigger profile pic backfill
app.get('/debug/fetch-avatars/:docId', async (req, res) => {
  const { docId } = req.params;
  try {
    const result = await sessionManager.backfillProfilePictures(docId);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// --- API Aliases for Flutter App ---
app.use((req, res, next) => {
  // Debug log for API routes
  if (req.url.startsWith('/api/conversations')) {
    console.log(`[API Debug] Hit: ${req.method} ${req.url}`);
  }
  next();
});

app.get("/api/conversations/:jid/messages", (req, res) => {
  const { jid } = req.params;
  console.log(`[API Alias] GET /api/conversations/${jid}/messages -> Rewriting to /messages/${jid}`);
  req.url = `/messages/${encodeURIComponent(jid)}`;
  req.originalUrl = req.url;
  app.handle(req, res);
});

app.post("/api/conversations/:jid/messages", (req, res) => {
  const { jid } = req.params;
  console.log(`[API Alias] POST /api/conversations/${jid}/messages -> Rewriting to /messages/${encodeURIComponent(jid)}`);
  req.url = `/messages/${encodeURIComponent(jid)}`;
  req.originalUrl = req.url;
  app.handle(req, res);
});

// --- JWT Helper (Unsafe Decode for MVP) ---
function getEmailFromToken(req) {
  // Return email from already-verified user (set by verifyFirebaseToken middleware)
  if (req.user && req.user.email) return req.user.email;
  
  // Fallback: decode WITHOUT verification — only for logging/non-critical use.
  // SECURITY: NEVER use this for authorization decisions!
  try {
    const auth = req.headers['authorization'];
    if (!auth) return null;
    const token = auth.split(' ')[1];
    if (!token) return null;
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(Buffer.from(base64, 'base64').toString());
    return decoded.email || null;
  } catch (e) {
    return null;
  }
}

// Employee Routes (Injected Fix)
app.get('/api/employees/me', async (req, res) => {
  const email = getEmailFromToken(req);
  console.log('GET /employees/me', email);
  
  if (!email) return res.status(401).json({ error: "No email in token" });

  try {
    const snapshot = await db.collection('employees').where('email', '==', email).limit(1).get();
    
    if (snapshot.empty) {
       // Automatic fallback for master admin if not in DB
       if (email === 'ursache.andrei1995@gmail.com') return res.json({ approved: true, role: 'admin', email });
       return res.json({ approved: false, role: 'user', email });
    }

    const data = snapshot.docs[0].data();
    return res.json({
      approved: data.approved === true,
      role: data.role || 'user',
      email: data.email || email,
      displayName: data.displayName
    });

  } catch (e) {
    console.error('Error in /employees/me:', e);
    // Fallback
    if (email === 'ursache.andrei1995@gmail.com') return res.json({ approved: true, role: 'admin', email });
    res.status(500).json({ error: e.toString() });
  }
});

app.post('/api/employees/request', async (req, res) => {
  const email = getEmailFromToken(req);
  console.log('POST /employees/request', email, req.body);
  const { displayName, phone } = req.body;

  if (!email) return res.status(401).json({ error: "No email" });

  try {
     const snapshot = await db.collection('employees').where('email', '==', email).limit(1).get();
     
     if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        await doc.ref.set({ 
           displayName: displayName || doc.data().displayName,
           phone: phone || doc.data().phone,
           lastLogin: new Date()
        }, { merge: true });
        return res.json({ status: doc.data().approved ? 'approved' : 'pending' });
     }

     const isMasterAdmin = (email === 'ursache.andrei1995@gmail.com');
     await db.collection('employees').add({
       email,
       displayName,
       phone,
       role: isMasterAdmin ? 'admin' : 'employee',
       approved: isMasterAdmin,
       createdAt: new Date(),
       uid: req.body.uid || ''
     });

     return res.json({ status: isMasterAdmin ? 'approved' : 'pending' });

  } catch (e) {
    console.error('Error requesting access:', e);
    res.status(500).json({ error: e.toString() });
  }
});

/* firebase admin removed */

// --- Admin Employee Management ---
app.get('/api/employees', async (req, res) => {
  try {
     const snapshot = await db.collection('employees').where('approved', '==', true).get(); 
     const employees = [];
     snapshot.forEach(doc => {
         // Exclude sensitive data if needed, but for admin view it's fine
         employees.push({ docId: doc.id, ...doc.data() });
     });
     res.json(employees);
  } catch(e) {
      console.error("Error listing employees:", e);
      res.status(500).json({error: e.message});
  }
});

app.get('/api/employees/requests', async (req, res) => {
  try {
     const snapshot = await db.collection('employees').get(); 
     const requests = [];
     snapshot.forEach(doc => {
         const data = doc.data();
         // Only true "new" requests: not approved AND not suspended
         if (data.approved !== true && data.suspended !== true) {
             requests.push({ docId: doc.id, ...data });
         }
     });
     res.json(requests);
  } catch(e) {
      console.error("Error listing requests:", e);
      res.status(500).json({error: e.message});
  }
});

app.get('/api/employees/suspended', async (req, res) => {
  try {
     const snapshot = await db.collection('employees').where('suspended', '==', true).get(); 
     const suspended = [];
     snapshot.forEach(doc => {
         suspended.push({ docId: doc.id, ...doc.data() });
     });
     res.json(suspended);
  } catch(e) {
      console.error("Error listing suspended:", e);
      res.status(500).json({error: e.message});
  }
});

app.post('/api/employees/:uid/approve', async (req, res) => {
    try {
        const { uid } = req.params;

        // 1. Get current data to find email
        const docRef = db.collection('employees').doc(uid); // uid here is actually docId from params
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
            return res.status(404).json({error: "Employee not found"});
        }
        const empData = docSnap.data();
        const email = empData.email;

        // 2. Update Firestore Employee Doc
        await docRef.set({ 
            approved: true,
            suspended: false, // Clear suspension
            role: 'employee',
            approvedAt: new Date()
        }, { merge: true });

        // 3. Set Custom Claim & CREATE USER PROFILE
        let authUid = empData.uid; // Try existing field
        console.log(`[Auth] Attempting claim for docId=${uid}, email=${email}, existingAuthUid=${authUid}`);
        
        try {
             let userRecord;
             // Try getting via UID if we have it
             if (authUid) {
                 try { 
                    userRecord = await getAuth().getUser(authUid); 
                    console.log(`[Auth] Found user via existing UID: ${authUid}`);
                 } catch(e) {
                    console.log(`[Auth] Failed lookup by existing UID ${authUid}: ${e.message}`);
                 }
             }
             
             // Fallback to email lookup
             if (!userRecord && email) {
                 try {
                    userRecord = await getAuth().getUserByEmail(email);
                    authUid = userRecord.uid;
                    console.log(`[Auth] Found user via Email ${email}: ${authUid}`);
                    // Save access to real UID in employee doc
                    await docRef.set({ uid: authUid }, { merge: true }); 
                 } catch(e) {
                    console.error(`[Auth] Failed lookup by Email ${email}: ${e.message}`);
                 }
             }

             if (userRecord) {
                 // A. Set Claims
                 await getAuth().setCustomUserClaims(userRecord.uid, { approved: true, role: 'employee' });
                 console.log(`[Auth] SUCCESS: Custom claims set for email ${email} (uid: ${userRecord.uid})`);

                 // B. CREATE USER PROFILE IN 'users' COLLECTION
                 // This ensures the "Profile" exists as requested by user
                 await db.collection('users').doc(userRecord.uid).set({
                    email: email,
                    displayName: empData.displayName || '',
                    phone: empData.phone || '',
                    role: 'employee',
                    approved: true,
                    createdAt: empData.createdAt || new Date(),
                    photoURL: userRecord.photoURL || '',
                    uid: userRecord.uid
                 }, { merge: true });
                 console.log(`[Profile] Created/Updated user profile for ${userRecord.uid}`);

             } else {
                 console.error(`[Auth] FATAL: Could not find Auth User for doc ${uid} / email ${email}`);
             }
        } catch (authErr) {
            console.error(`[Auth] Unexpected error setting claims/profile:`, authErr);
            // DO NOT THROW. Proceed to return success for Firestore update.
        }

        res.json({ status: 'approved', docId: uid, authUid });
    } catch(e) {
        console.error("Error approving:", e);
        res.status(500).json({error: e.message});
    }
});

app.post('/api/employees/:uid/suspend', async (req, res) => {
    try {
        const { uid } = req.params;
        await db.collection('employees').doc(uid).set({ 
            approved: false,
            suspended: true,
            suspendedAt: new Date()
        }, { merge: true });

        // Remove Claim
        try {
             await getAuth().setCustomUserClaims(uid, { approved: false });
        } catch (e) { /* ignore */ }

        res.json({ status: 'suspended', uid });
    } catch(e) {
        console.error("Error suspending:", e);
        res.status(500).json({error: e.message});
    }
});

app.post('/api/employees/:uid/reject', async (req, res) => {
    try {
        const { uid } = req.params;
        await db.collection('employees').doc(uid).set({ 
            approved: false,
            rejectedAt: new Date()
        }, { merge: true });

        // Remove Claim
        try {
             await getAuth().setCustomUserClaims(uid, { approved: false });
        } catch (e) { /* ignore */ }

        res.json({ status: 'rejected', uid });
    } catch(e) {
        console.error("Error rejecting:", e);
        res.status(500).json({error: e.message});
    }
});

app.get("/ping", (req, res) => res.send("pong " + Date.now()));

/* ========== Helpers for Normalization ========== */
function normalizeTs(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = Number(val);
    return Number.isNaN(n) ? 0 : n;
  }
  if (typeof val === 'object' && val !== null) {
    if ('low' in val) return Number(val.low) || 0;
    if ('_seconds' in val) return Number(val._seconds) || 0;
    for (const k of Object.keys(val)) {
      const n = Number(val[k]);
      if (!Number.isNaN(n) && n > 0) return n;
    }
  }
  return 0;
}

function normalizeUnread(u) {
  if (!u) return 0;
  if (typeof u === 'number') return Math.floor(u);
  if (typeof u === 'string') {
    const n = Number(u);
    return Number.isNaN(n) ? 0 : Math.floor(n);
  }
  if (typeof u === 'object' && u !== null) {
    if ('low' in u) return Number(u.low) || 0;
    for (const k of Object.keys(u)) {
      const n = Number(u[k]);
      if (!Number.isNaN(n)) return Math.floor(n);
    }
  }
  return 0;
}

/* ========== Express Routes ========== */

/* ========== DEBUG ROUTE FOR STORE STATS ========== */
app.get("/debug/store-stats", (req, res) => {
  const chatsCount = (store.chats instanceof Map) ? store.chats.size : Object.keys(store.chats || {}).length;
  const messagesCount = (store.messages instanceof Map) ? store.messages.size : Object.keys(store.messages || {}).length;
  const contactsCount = (store.contacts instanceof Map) ? store.contacts.size : Object.keys(store.contacts || {}).length;
  
  res.json({
    chats: chatsCount,
    messages: messagesCount,
    contacts: contactsCount,
    sessions: sessionManager.sessions.size,
    sessionIds: Array.from(sessionManager.sessions.keys())
  });
});

/* ========== API ADAPTERS FOR FLUTTER APP compatibility ========== */
// Flutter expects /api/conversations etc.
app.get("/api/conversations", (req, res) => {
  // redirect to /chats logic
  req.url = "/chats";
  app.handle(req, res);
});



app.get("/status", (req, res) => {
  // Return aggregated status for debug
  const sessions = [];
  if (sessionManager && sessionManager.sessions) {
     sessionManager.sessions.forEach((val, key) => {
         sessions.push({
             docId: key,
             status: val.status,
             qr: !!val.qr,
             phone: val.sock?.user?.id?.split(':')[0]
         });
     });
  }
  
  res.json({ 
    status: "ok", 
    mode: "multi-session",
    sessions
  });
});

// --- Pairing UI ---
app.get("/pair", (req, res) => {
  // Simple debug UI to see all active QRs
  res.send(`
    <html>
      <head>
        <title>WhatsApp Multi-Pairing</title>
        <meta http-equiv="refresh" content="5">
      </head>
      <body>
        <h1>Active QR Codes</h1>
        <div id="qrs">Fetching...</div>
        <script>
            fetch('/status').then(r=>r.json()).then(d => {
                const div = document.getElementById('qrs');
                if(!d.sessions || d.sessions.length === 0) {
                    div.innerHTML = "No active sessions found.";
                } else {
                    div.innerHTML = d.sessions.map(s => \`
                        <div style="border:1px solid #ccc; padding:10px; margin:10px;">
                            <h3>One-Time Account ID: \${s.docId}</h3>
                            <p>Status: <b>\${s.status}</b></p>
                            \${s.qr ? \`<p>QR Available (Scan in App)</p>\` : ''}
                            \${s.phone ? \`<p>Connected Phone: \${s.phone}</p>\` : ''}
                        </div>
                    \`).join('');
                }
            });
        </script>
      </body>
    </html>
  `);
});

// --- Helper: normalize timestamp extraction
function getMsgTs(m) {
  if (!m) return 0;
  // try many places
  const tsCandidates = [
    m.messageTimestamp,
    m.message && m.message.messageTimestamp,
    m.message && m.message.messageTimestamp?.low,
    m.message && m.message.messageTimestamp?._seconds,
    m.messageTimestamp?.low,
    m.messageTimestamp?._seconds
  ];
  for (const c of tsCandidates) {
    if (c === undefined || c === null) continue;
    if (typeof c === 'number') return Number(c);
    if (typeof c === 'string') {
      const n = Number(c);
      if (!Number.isNaN(n)) return n;
    }
    if (typeof c === 'object') {
      if ('low' in c) return Number(c.low || 0);
      if ('_seconds' in c) return Number(c._seconds || 0);
    }
  }
  return 0;
}

// --- Robust /chats route with DEDUPLICATION
app.get("/chats", (req, res) => {
  try {
    const rawChats = store.chats;
    const unifiedMap = new Map(); // canonicalJid -> { ...mergedData }

    const processChat = (jid, meta) => {
      try {
        if (!jid || jid === '0@s.whatsapp.net') return;
        
        // Resolve canonical (prefer phone number)
        let canonical = resolveCanonicalJid(jid);
        if (!canonical) canonical = jid;

        // Extract metadata
        const unread = normalizeUnread(meta.unreadCount || meta.unread || 0);
        const lastTs = normalizeTs(
          meta.conversationTimestamp?.low || 
          meta.lastMessageRecvTimestamp || 
          meta.conversationTimestamp || 0
        );
        const name = meta.name || meta.subject || meta.notify || '';
        const lastMsgText = meta.lastMessageText || '';
        const lastSender = meta.lastSender || '';

        // If generic name, try to find better name from contact
        let displayName = name;
        if (!displayName) {
           const c = getContact(canonical);
           if (c && (c.name || c.notify)) displayName = c.name || c.notify;
        }

        // Merge or Create
        if (unifiedMap.has(canonical)) {
          const existing = unifiedMap.get(canonical);
          
          // Sum unread
          existing.unread += unread;
          
          // Use latest timestamp and message
          if (lastTs > existing.lastMessage) {
            existing.lastMessage = lastTs;
            existing.lastMessageText = lastMsgText;
            existing.lastSender = lastSender;
          }
          
          // Keep best name
          if (!existing.name && displayName) existing.name = displayName;
          
        } else {
          unifiedMap.set(canonical, {
            id: canonical,
            name: displayName,
            phoneNumber: (canonical.endsWith('@g.us')) ? null : canonical.split('@')[0],
            unread: unread,
            lastMessage: lastTs,
            lastMessageText: lastMsgText,
            lastSender: lastSender
          });
        }
      } catch (e) {
        console.error('Error processing chat:', jid, e);
      }
    };

    // Iterate Store
    if (Array.isArray(rawChats)) {
      for (const entry of rawChats) {
        if (entry && entry[0]) processChat(entry[0], entry[1] || {});
      }
    } else if (rawChats && typeof rawChats === 'object') {
      const entries = rawChats instanceof Map ? Array.from(rawChats.entries()) : Object.entries(rawChats);
      for (const [jid, meta] of entries) {
        processChat(jid, meta);
      }
    }

    // Convert to list
    const list = Array.from(unifiedMap.values());

    // sort desc by lastMessage
    list.sort((a,b) => (b.lastMessage || 0) - (a.lastMessage || 0));
    
    res.json(list);
  } catch (err) {
    console.error('/chats error', err);
    res.status(500).json({ error: err.toString() });
  }
});

// --- Robust /messages/:jid route
app.get("/messages/:jid", (req, res) => {
  const { jid } = req.params;
  const limit = parseInt(req.query.limit) || 1000;
  
  if (!jid) return res.status(400).json({ error: "Missing jid" });

  const canonical = resolveCanonicalJid(jid);
  const partners = findPartnerJids(jid);

  let allMessages = [];
  
  // 1. Pull from store.messages (Map or Object)
  if (store.messages) {
    for (const p of partners) {
       // Also try to update contact name if missing
       if (store.contacts && store.contacts[p]) {
           const c = store.contacts[p];
           // If we have a better name here, we might want to return it? 
           // For now, messages route focuses on messages.
       }

       const msgs = getMessagesForJid(p);
       allMessages = allMessages.concat(msgs);
    }
  }

  // 2. Sort & Dedupe
  const seen = new Set();
  const unique = [];
  
  allMessages.sort((a, b) => {
    const tA = getMsgTs(a);
    const tB = getMsgTs(b);
    return tB - tA; // Newest first
  });

  for (const m of allMessages) {
    if (!m.key || !m.key.id) continue;
    if (seen.has(m.key.id)) continue;
    seen.add(m.key.id);
    unique.push(m);
  }

  // 3. Slice if needed (optimization)
  let result = unique;
  if (limit > 0 && result.length > limit) {
     result = result.slice(0, limit);
  }
  
  // 4. Sort ASC for chat
  result.sort((a, b) => {
     return getMsgTs(a) - getMsgTs(b);
  });

  res.json(result);
});

// --- Media Download Route ---
app.get("/media/:jid/:id", async (req, res) => {
  const { jid, id } = req.params;
  
  try {
     // 1. Find message
     const partners = findPartnerJids(jid);
     
     let foundMsg = null;
     if (store.messages) {
        for (const p of partners) {
           const msgs = getMessagesForJid(p);
           const m = msgs.find(x => x.key && x.key.id === id);
           if (m) {
              foundMsg = m;
              break;
           }
        }
     }
     
     if (!foundMsg) {
        return res.status(404).json({ error: "Message not found" });
     }

     // 2. Download
     const logger = pino({ level: 'silent' });
     
     const buffer = await downloadMediaMessage(
        foundMsg,
        'buffer',
        { logger }
     );
     
     if (!buffer) {
        return res.status(404).json({ error: "Empty buffer" });
     }

     // 3. Detect Mime
     let mimetype = 'application/octet-stream';
     let msgContent = foundMsg.message;
     
     if (msgContent) {
        // unwraps
        if (msgContent.message) msgContent = msgContent.message;
        if (msgContent.ephemeralMessage) msgContent = msgContent.ephemeralMessage.message;
        if (msgContent.viewOnceMessage) msgContent = msgContent.viewOnceMessage.message;

        if (msgContent.imageMessage) mimetype = msgContent.imageMessage.mimetype || 'image/jpeg';
        else if (msgContent.videoMessage) mimetype = msgContent.videoMessage.mimetype || 'video/mp4';
        else if (msgContent.documentMessage) mimetype = msgContent.documentMessage.mimetype || 'application/pdf';
        else if (msgContent.stickerMessage) mimetype = msgContent.stickerMessage.mimetype || 'image/webp';
        else if (msgContent.audioMessage) mimetype = msgContent.audioMessage.mimetype || 'audio/mp4';
     }

     res.set('Content-Type', mimetype);
     res.send(buffer);

  } catch (e) {
     console.error("Media download error:", e);
     res.status(500).json({ error: "Download failed", details: e.message });
  }
});


// --- Mark as Read Route
app.post("/chats/:jid/read", async (req, res) => {
  const { jid } = req.params;
  try {
    const partners = findPartnerJids(jid);
    let updated = 0;

    // Helper to clear unread
    const clearUnread = (targetJid) => {
      if (store.chats && Array.isArray(store.chats)) {
        for (const entry of store.chats) {
          if (entry[0] === targetJid && entry[1]) {
            entry[1].unreadCount = 0;
            updated++;
          }
        }
      } else if (store.chats && typeof store.chats === 'object') {
        const meta = store.chats[targetJid] || (store.chats.get && store.chats.get(targetJid));
        if (meta) {
          meta.unreadCount = 0;
          updated++;
        }
      }
    };

    partners.forEach(p => clearUnread(p));
    
    res.json({ status: "ok", updated });
  } catch (e) {
    console.error("Error marking read:", e);
    res.status(500).json({ error: e.toString() });
  }
});

/* ========== Outbound Media Endpoint ========== */
app.post("/messages/:jid/media", upload.single('file'), async (req, res) => {
  let jid = req.params.jid;
  const { accountId, caption, type: mediaType } = req.body;
  const requestId = req.id || req.headers['x-request-id'] || `out-media-${Date.now()}`;

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (!jid) return res.status(400).json({ error: 'Missing jid' });

  // Canonicalize JID
  if (jid) jid = jid.replace('+', '');
  const canonicalJid = resolveCanonicalJid(jid) || jid;
  jid = canonicalJid;

  // Find active session
  let sock = null;
  let docId = accountId || null;
  if (docId) {
    const session = sessionManager.sessions.get(docId);
    sock = session?.sock;
  }
  if (!sock) {
    for (const [id, session] of sessionManager.sessions) {
      if (session.sock) { sock = session.sock; docId = id; break; }
    }
  }
  if (!sock) return res.status(503).json({ error: 'No active WhatsApp session' });

  const convoId = docId ? `${docId}_${canonicalJid}` : canonicalJid;
  console.log(`[Media-Debug] POST /messages/:jid/media for JID: ${jid}, accountId: ${docId}, convoId: ${convoId}`);

  try {
    // Determine Baileys message type
    const buffer = req.file.buffer;
    const mime = req.file.mimetype;
    const fileName = req.file.originalname;
    let msgPayload;

    const detectedType = mediaType || (mime?.startsWith('image/') ? 'image' : mime?.startsWith('video/') ? 'video' : mime?.startsWith('audio/') ? 'audio' : 'document');

    switch (detectedType) {
      case 'image':
        msgPayload = { image: buffer, caption: caption || undefined, mimetype: mime };
        break;
      case 'video':
        msgPayload = { video: buffer, caption: caption || undefined, mimetype: mime };
        break;
      case 'audio':
        msgPayload = { audio: buffer, mimetype: mime, ptt: mime === 'audio/ogg' };
        break;
      default:
        msgPayload = { document: buffer, mimetype: mime, fileName: fileName || 'file' };
    }

    const sent = await sock.sendMessage(jid, msgPayload);
    const messageId = sent?.key?.id || `local-${Date.now()}`;

    // Upload to Firebase Storage
    const mediaObj = await uploadMediaToStorage(buffer, convoId, messageId, mime, buffer.length, fileName);

    // Sync to Firestore
    const preview = caption || (detectedType === 'image' ? '📷 Photo' : detectedType === 'video' ? '🎥 Video' : '📎 File');
    const syncOptions = { resolveCanonicalJid, messageId };
    if (mediaObj) syncOptions.media = mediaObj;
    await syncMessageToFirestore(sent, jid, preview, null, docId, '', syncOptions);

    res.json({ status: 'sent', messageId, convoId, media: mediaObj || null });
  } catch (e) {
    console.error('[OutboundMedia Error]', e);
    
    // Add WhatsApp specific error parsing identical to the text messages endpoint
    const errorString = e.toString().toLowerCase();
    if (errorString.includes('forbidden') || errorString.includes('not-authorized')) {
        return res.status(403).json({
            error: "forbidden",
            details: "Numarul tau a fost blocat sau nu poti trimite mesaje in acest grup/catre acest contact.",
            raw: e.toString()
        });
    }
    
    res.status(500).json({ error: e.message });
  }
});

// --- NEW: Send Message Route
app.post("/messages/:jid", async (req, res) => {
  let { jid } = req.params;
  let { text, accountId } = req.body; 

  // Normalize JID: WhatsApp Baileys requires pure numeric JIDs.
  // Stripping '+' prevents the duplicate thread bug where outgoing has '+' but incoming network replies don't.
  if (jid) {
      jid = jid.replace('+', '');
  }

  console.log(`[Send-Debug] Request received for JID: ${jid}`);
  console.log(`[Send-Debug] Body:`, JSON.stringify(req.body));

  // PARSE COMPOSITE ID (AccountId_ClientJid) for multi-tenancy
  // If jid starts with a known Account ID, extract it.
  if (!accountId && jid.includes('_')) {
      const parts = jid.split('_');
      const potentialAccId = parts[0];
      // Check if this prefix is a valid, active session
      if (sessionManager.getSession(potentialAccId)) {
          accountId = potentialAccId;
          jid = parts.slice(1).join('_'); // The rest is the real JID
          console.log(`[Send-Debug] Extracted AccountId: ${accountId}, Real JID: ${jid}`);
      }
  }

  if (!text) {
      console.log(`[Send-Debug] Error: Missing text`);
      return res.status(400).json({ error: "Missing text" });
  }

  // 1. Determine which session to use
  let sock = null;

  if (accountId) {
      // Explicit selection
      sock = sessionManager.getSession(accountId);
      if (!sock) console.log(`[Send-Debug] Explicit account ${accountId} not active.`);
      else console.log(`[Send-Debug] Using explicit account session: ${accountId}`);
  } else {
      // Auto-selection (fallback to first connected)
      // Iterate sessions
      for (const [docId, s] of sessionManager.sessions) {
          if (s.status === 'connected' && s.sock) {
              sock = s.sock;
              console.log(`[Send-Debug] Auto-selected session: ${docId}`);
              // Ideally check if this sock has relationship with JID?
              // For now, first available.
              break;
          }
      }
      if (!sock) console.log(`[Send-Debug] No auto-selected session found.`);
  }

  if (!sock) {
      console.log(`[Send-Debug] CRITICAL: No active WhatsApp session found to send message.`);
      return res.status(503).json({ error: "No active WhatsApp session found" });
  }

  try {
    console.log(`[Send-Debug] Request received for JID: ${jid}`);
    console.log(`[Send-Debug] Body:`, JSON.stringify(req.body));

    const sent = await sock.sendMessage(jid, { text });
    console.log('[Send-Debug] sendMessage result:', JSON.stringify(sent));

    // Defensive extraction of message id
    const messageId = sent?.key?.id || sent?.id || (sent && sent.message && sent.message.id) || `local-${Date.now()}`;

    // Prepare sync payload
    const originJid = jid;
    const isGroup = originJid.endsWith('@g.us');
    let chatName = isGroup ? null : originJid.split('@')[0];

    if (isGroup) {
      try {
        const groupMetadata = await sock.groupMetadata(originJid);
        if (groupMetadata && groupMetadata.subject) chatName = groupMetadata.subject;
      } catch (e) {
        console.log(`[Send] Failed to fetch metadata for ${originJid}:`, e && e.message);
      }
    }

    // Find session doc id & label safely
    let docId = null;
    let label = '';
    for (const [dId, s] of sessionManager.sessions) {
      if (s && s.sock === sock) { docId = dId; label = s.label || ''; break; }
    }

    // Call sync with fallback messageId and full sent object
    try {
      await syncMessageToFirestore(sent, originJid, text, chatName, docId, label, { messageId });
    } catch (syncErr) {
      console.error('Error syncing outbound message (non-fatal):', syncErr);
    }

    res.json({ status: 'ok', data: sent });
  } catch (e) {
    console.error('Error sending message:', e && (e.stack || e.toString()));
    
    // Convert Baileys generic forbidden to a user-friendly JSON
    const errorString = e.toString().toLowerCase();
    if (errorString.includes('forbidden')) {
        return res.status(403).json({ error: "Nu mai aveți permisiunea de a scrie în această conversație (grup restricționat sau contact blocat)." });
    } else if (errorString.includes('not-authorized')) {
        return res.status(401).json({ error: "Sesiune WhatsApp invalidă. Trebuie să vă reconectați." });
    }
    
    res.status(500).json({ error: e.toString() });
  }
});

app.post("/admin/link-lid", (req, res) => {
  const { lid, phoneJid } = req.body;
  if (!lid || !phoneJid) return res.status(400).json({ error: "Missing lid or phoneJid" });

  // Update memory
  lidOverrides[lid] = phoneJid;
  saveLidOverrides();

  // Update store contact if exists
  const contact = getContact(lid);
  if (contact) {
    contact.phoneNumber = phoneJid;
    setContact(lid, contact);
  } else {
    setContact(lid, { id: lid, phoneNumber: phoneJid });
  }
  scheduleStoreWrite();

  res.json({ status: "ok", mapped: { [lid]: phoneJid } });
});

app.get("/debug/contact/:id", (req, res) => {
  const c = getContact(req.params.id);
  res.json(c || { error: "Not found" });
});

app.get("/download-store", (req, res) => {
  if (fs.existsSync(STORE_FILE)) {
    res.download(STORE_FILE);
  } else {
    res.status(404).json({ error: "Store file not found" });
  }
});

app.get("/debug/name-resolution/:jid", (req, res) => {
  const { jid } = req.params;
  const candidates = findPartnerJids(jid);
  let msgs = [];
  for(const k of candidates) {
     msgs = msgs.concat(getMessagesForJid(k));
  }
  msgs.sort((a,b) => (b.messageTimestamp || 0) - (a.messageTimestamp || 0));
  
  const sample = msgs.slice(0, 20).map(m => ({
    key: m.key,
    pushName: m.pushName,
    verifiedBizName: m.verifiedBizName,
    fromMe: m.key ? m.key.fromMe : 'unknown',
    ts: m.messageTimestamp
  }));
  
  res.json({
    jid,
    candidates,
    totalMessages: msgs.length,
    sample
  });
});


// requireSupabaseAuth: validates Supabase JWT (sent by Flutter via Supabase session)
// Flutter uses currentSession?.accessToken (Supabase JWT), not Firebase ID token.
async function requireSupabaseAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing Bearer token' });
  }
  const token = auth.split('Bearer ')[1];
  // Verify via Supabase getUser (JWT introspection) — no Firebase needed
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      console.warn('[requireSupabaseAuth] SUPABASE_URL or SERVICE_KEY not set, using lenient mode');
      return next(); // fallback: allow if env not configured
    }
    const resp = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: {
        'Authorization': 'Bearer ' + token,
        'apikey': SUPABASE_SERVICE_KEY,
      },
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.error('[requireSupabaseAuth] Supabase rejected token:', resp.status, body.slice(0, 200));
      return res.status(401).json({ error: 'invalid_token', message: 'Supabase token invalid or expired' });
    }
    req.supabaseUser = await resp.json();
    return next();
  } catch (e) {
    console.error('[requireSupabaseAuth] Error:', e.message);
    return res.status(401).json({ error: 'auth_error', message: e.message });
  }
}

/* ===== ACCOUNT MANAGEMENT API ===== */

// GET /api/wa-accounts - List accounts
app.get("/api/wa-accounts", (req, res) => {
  const accounts = [];
  sessionManager.sessions.forEach((val, key) => {
      accounts.push({
          id: key,
          label: val.label || key, // We might need to fetch label from Firestore if not in memory
          status: val.status,
          phoneNumber: val.sock?.user?.id?.split(':')[0] || ''
      });
  });
  res.json(accounts);
});

// POST /api/accounts/:id/regenerate-qr — Supabase JWT auth
app.post("/api/accounts/:id/regenerate-qr", requireSupabaseAuth, async (req, res) => {
  const docId = req.params.id;
  const force = req.query.force === 'true';
  const ip = req.ip || req.connection?.remoteAddress || '?';
  const ua = (req.headers['user-agent'] || '').substring(0, 60);
  console.log(`[HTTP] POST /regenerate-qr docId=${docId} force=${force} user=${req.supabaseUser?.email || '?'}`);
  try {
    const result = await sessionManager.regenerateQR(docId, { force, ip, ua });
    const httpCode = result.status === 'cooldown' ? 429 : 200;
    res.status(httpCode).json({ ok: true, ...result });
  } catch (e) {
    console.error("[regenerate-qr] Error:", e);
    res.status(500).json({ error: e.message });
  }
});



/* ===== SECURE AUTH MIDDLEWARE & RESERVE ROUTES ===== */

// Secure Firebase token verification middleware
async function verifyFirebaseToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthenticated', message: 'Missing Bearer token' });
  }
  const token = authHeader.split('Bearer ')[1];
  try {
    const decoded = await { setCustomUserClaims: async () => {}, getUser: async () => ({}) }.verifyIdToken(token);
    req.user = decoded; // decoded.uid available
    return next();
  } catch (e) {
    console.error('Token verify error:', e && e.stack ? e.stack : e);
    return res.status(401).json({ error: 'unauthenticated', message: 'Invalid token' });
  }
}

/**
 * POST /api/conversations/:id/reserve
 * Regex route to accept @ in id (groups, phones, lids)
 * Requires Authorization: Bearer <idToken>
 */
app.post(/^\/api\/conversations\/(.+)\/reserve$/, verifyFirebaseToken, async (req, res) => {
  const convoId = req.params[0];
  const uid = req.user && req.user.uid;
  if (!uid) return res.status(401).json({ error: 'unauthenticated', message: 'Missing uid' });

  const ttlMinutes = parseInt(req.body.ttlMinutes, 10) || 15;
  const reservedUntilTs = new Date(Date.now() + ttlMinutes * 60 * 1000);
  const convoRef = db.collection('conversations').doc(convoId);

  try {
    await db.runTransaction(async (t) => {
      const snap = await t.get(convoRef);
      if (!snap.exists) throw new Error('conversation_not_found');

      const existingReservedBy = snap.get('reservedBy') || null;
      const existingReservedUntil = snap.get('reservedUntil') || null;

      // Refresh if same user
      if (existingReservedBy && existingReservedBy === uid) {
        t.update(convoRef, {
          reservedBy: uid,
          reservedAt: new Date(),
          reservedUntil: reservedUntilTs
        });
        return;
      }

      // If reserved by another user and not expired -> conflict
      if (existingReservedBy && existingReservedBy !== uid) {
        if (existingReservedUntil && typeof existingReservedUntil.toMillis === 'function') {
          const existingUntilMs = existingReservedUntil.toMillis();
          if (existingUntilMs > Date.now()) {
            throw new Error('already_reserved');
          }
          // expired -> allow reservation
        } else {
          throw new Error('already_reserved');
        }
      }

      // not reserved or expired -> set reservation
      t.update(convoRef, {
        reservedBy: uid,
        reservedAt: new Date(),
        reservedUntil: reservedUntilTs
      });
    });

    console.log('[RESERVE] convo=%s by=%s ttlMinutes=%d', convoId, uid, ttlMinutes);
    return res.json({ ok: true, convoId, reservedBy: uid, ttlMinutes });
  } catch (err) {
    console.error('[RESERVE FAILED] convo=%s err=%s', convoId, err && err.message, err);
    if (err.message === 'conversation_not_found') return res.status(404).json({ error: 'conversation_not_found' });
    if (err.message === 'already_reserved') return res.status(409).json({ error: 'already_reserved' });
    return res.status(500).json({ error: 'Failed to reserve', message: err.message || String(err) });
  }
});

/**
 * GET /api/conversations/:id/reservation
 * Debug helper to return reservation status (UI-friendly)
 */
app.get(/^\/api\/conversations\/(.+)\/reservation$/, async (req, res) => {
  const convoId = req.params[0];
  try {
    const doc = await db.collection('conversations').doc(convoId).get();
    if (!doc.exists) return res.status(404).json({ error: 'conversation_not_found' });
    const d = doc.data();
    return res.json({
      reservedBy: d.reservedBy || null,
      reservedAt: d.reservedAt ? d.reservedAt.toDate().toISOString() : null,
      reservedUntil: d.reservedUntil ? d.reservedUntil.toDate().toISOString() : null
    });
  } catch (err) {
    console.error('GET reservation error', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

/* ===== END SECURE AUTH & RESERVE ===== */

/* ===== COMPLIANCE & PRIVACY APIS (GDPR/Play Safety) ===== */

/**
 * POST /api/user/consent
 * Stores user consent for call recording/data processing.
 */
app.post('/api/user/consent', verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { consentVersion, userAgent } = req.body;
    
    await db.collection('users').doc(uid).collection('consents').add({
      consentVersion: consentVersion || 'v1',
      userAgent: userAgent || req.headers['user-agent'] || 'unknown',
      ip: req.ip,
      timestamp: new Date(),
      type: 'employee_recording_agreement'
    });

    // Also update main user profile with latest consent
    await db.collection('users').doc(uid).set({
      latestConsentVersion: consentVersion || 'v1',
      consentGivenAt: new Date()
    }, { merge: true });

    res.json({ status: 'ok' });
  } catch (e) {
    console.error("Error saving consent:", e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/user/deletion-request
 * Creates a ticket for data deletion.
 */
app.post('/api/user/deletion-request', verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { reason } = req.body;

    const ticketRef = await db.collection('deletion_requests').add({
      uid,
      email: req.user.email || 'unknown',
      reason: reason || 'user_request',
      status: 'pending',
      requestedAt: new Date()
    });

    res.json({ status: 'received', ticketId: ticketRef.id });
  } catch (e) {
    console.error("Error creating deletion request:", e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/user/privacy-settings
 * Updates user privacy preferences (e.g. AI analysis).
 */
app.post('/api/user/privacy-settings', verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    // explicit check for boolean to allow false
    const { aiAnalysisEnabled } = req.body;

    if (aiAnalysisEnabled === undefined) {
      return res.status(400).json({ error: "Missing aiAnalysisEnabled" });
    }

    await db.collection('users').doc(uid).set({
      privacySettings: {
        aiAnalysisEnabled: !!aiAnalysisEnabled,
        updatedAt: new Date()
      }
    }, { merge: true });

    res.json({ status: 'updated', aiAnalysisEnabled });
  } catch (e) {
    console.error("Error updating privacy settings:", e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/user/me
 * Returns the current user's profile (including consent status).
 */
app.get('/api/user/me', verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const doc = await db.collection('users').doc(uid).get();
    
    if (!doc.exists) {
      return res.json({ exists: false, uid });
    }
    
    res.json({ exists: true, ...doc.data() });
  } catch (e) {
    console.error("Error fetching user profile:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ===== END COMPLIANCE APIS ===== */

/* Start server & WhatsApp connect (minimal) */

// ══ WhatsApp Durable Outbox Routes ══════════════════════════════════════════
// POST /api/wa/outbox/send  — enqueue durabil (idempotent, auth Firebase)
// POST /api/wa/send-direct  — send real Baileys, doar WA_INTERNAL_TOKEN
// GET  /debug/outbox/{dlq,stats}  POST /debug/outbox/replay
import { registerOutboxRoutes } from './server/whatsapp/workers/wa-outbox-api.mjs';
import { supabase as sbOutbox } from './supabase-sync.mjs';

const waSessionAdapter = {
  sendText: async function(accountId, jid, text) {
    const sessionData = sessionManager.sessions.get(accountId);
    let sock = sessionData ? sessionData.sock : null;
    if (!sock) {
      const iter = sessionManager.sessions.values();
      let s = iter.next();
      while (!s.done) { if (s.value.sock) { sock = s.value.sock; break; } s = iter.next(); }
    }
    if (!sock) throw new Error('No active WA session for ' + accountId);
    const result = await sock.sendMessage(jid, { text });
    return { messageId: result && result.key ? result.key.id : null };
  },
  sendMedia: async function(accountId, jid, mediaUrl, caption, type) {
    const sessionData = sessionManager.sessions.get(accountId);
    let sock = sessionData ? sessionData.sock : null;
    if (!sock) {
      const iter = sessionManager.sessions.values();
      let s = iter.next();
      while (!s.done) { if (s.value.sock) { sock = s.value.sock; break; } s = iter.next(); }
    }
    if (!sock) throw new Error('No active WA session for ' + accountId);
    const typeMap = { image: 'image', video: 'video', document: 'document', audio: 'audio' };
    const key = typeMap[type] || 'document';
    const payload = {};
    payload[key] = { url: mediaUrl };
    if (caption) payload.caption = caption;
    const result = await sock.sendMessage(jid, payload);
    return { messageId: result && result.key ? result.key.id : null };
  },
};

function outboxAuth(req, res, next) { return requireFirebaseAuth(req, res, next); }
registerOutboxRoutes(app, sbOutbox, outboxAuth, waSessionAdapter);
console.log('[OutboxRoutes] Mounted: /api/wa/outbox/send  /api/wa/send-direct  /debug/outbox/*');
// ════════════════════════════════════════════════════════════════════════════

// Health endpoint (duplicate, registered before listen for nginx)
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`API Server running on port ${PORT}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// VoIP WebSocket Server — Foreground ring delivery for Flutter app
// Flutter connects to wss://voice.superparty.ro/api/voip-ws?token=JWT
// ═══════════════════════════════════════════════════════════════════════════
const WS_SECRET = process.env.VOIP_WS_SECRET || process.env.SUPABASE_JWT_SECRET || 'superparty_ws_secret_2024';

/** In-memory registry: identity → WebSocket */
const voipClients = new Map(); // key: identity, value: ws

/** Issue a short-lived signed token for WS auth */
function issueWsToken(identity) {
  const payload = { identity, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 43200 };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  // Simple signed token (Node.js built-in)
  let sig;
  try {
    sig = crypto.createHmac('sha256', WS_SECRET).update(b64).digest('base64url');
  } catch(e) {
    // Fallback: use hash without HMAC
    sig = crypto.createHash('sha256').update(b64 + WS_SECRET).digest('base64url');
  }
  return `${b64}.${sig}`;
}

/** Verify WS token, returns payload or null */
function verifyWsToken(token) {
  try {
    const [b64, sig] = token.split('.');
    let expected;
    try { expected = crypto.createHmac('sha256', WS_SECRET).update(b64).digest('base64url'); }
    catch(e) { expected = crypto.createHash('sha256').update(b64 + WS_SECRET).digest('base64url'); }
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now()/1000)) return null;
    return payload;
  } catch { return null; }
}

/** Send incoming_call notification to all registered agents */
function notifyVoipClients(payload) {
  const msg = JSON.stringify(payload);
  let sent = 0;
  voipClients.forEach((ws, identity) => {
    if (ws.readyState === 1) { // OPEN
      ws.send(msg);
      sent++;
      console.log(`[VoIP WS] → Sent incoming_call to ${identity}`);
    }
  });
  console.log(`[VoIP WS] notifyVoipClients: ${sent}/${voipClients.size} clients notified`);
}

// REST endpoint: issue WS token (called by Flutter before connecting)
app.get('/api/auth/get-ws-token', async (req, res) => {
  try {
    const identity = req.query.identity;
    if (!identity) return res.status(400).json({ error: 'Missing identity' });
    const token = issueWsToken(identity);
    res.json({ token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// WebSocket upgrade server on the same HTTP server
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/api/voip-ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  const payload = token ? verifyWsToken(token) : null;

  if (!payload) {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid or expired token' }));
    ws.close();
    return;
  }

  let identity = payload.identity;
  console.log(`[VoIP WS] Client connected: ${identity}`);

  // Register on message (or use token identity directly)
  voipClients.set(identity, ws);
  ws.send(JSON.stringify({ type: 'registered', identity }));

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      if (data.type === 'register' && data.identity) {
        identity = data.identity;
        voipClients.set(identity, ws);
        ws.send(JSON.stringify({ type: 'registered', identity }));
        console.log(`[VoIP WS] Re-registered: ${identity}`);
      } else if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (e) { /* ignore malformed */ }
  });

  ws.on('close', () => {
    console.log(`[VoIP WS] Client disconnected: ${identity}`);
    if (voipClients.get(identity) === ws) voipClients.delete(identity);
  });

  ws.on('error', (e) => console.error(`[VoIP WS] Error for ${identity}:`, e.message));
});

console.log('[VoIP WS] WebSocket server ready on /api/voip-ws');


/* Signal handling for safe shutdown */

// ─── Health endpoint ─────────────────────────────────────────
app.get('/health', function(req, res) {
  var s = 0;
  try { s = sessionManager.sessions.size; } catch (e) {}
  res.json({
    status: 'ok',
    service: 'superparty-backend',
    uptime: Math.round(process.uptime()),
    sessions: s,
    ts: new Date().toISOString(),
  });
});


// GET /metrics — Prometheus, ADMIN_TOKEN protected
app.get('/metrics', requireAdminTokenMw, async function(req, res) {
  try {
    const metrics = await metricsRegistry.metrics();
    res.setHeader('Content-Type', metricsRegistry.contentType);
    res.send(metrics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// --- Debug: recent messages (admin only) ---
app.get('/debug/recent-messages', requireAdminTokenMw, async (req, res) => {
  const accountId = req.query.accountId || null;
  try {
    const { supabase: _sb } = await import('./supabase-sync.mjs');
    let q = _sb.from('messages')
      .select('id,account_id,message_id,direction,text,ts,created_at')
      .order('created_at', { ascending: false }).limit(20);
    if (accountId) q = q.eq('account_id', accountId);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ count: data.length, messages: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// --- DLQ: list failed jobs (admin only) ---
app.get('/debug/dlq', requireAdminTokenMw, async (req, res) => {
  try {
    const { Queue } = await import('bullmq');
    const REDIS = { host: process.env.REDIS_HOST || '127.0.0.1', port: 6379, maxRetriesPerRequest: null };
    const dlq = new Queue('wa-dlq', { connection: REDIS });
    const jobs = await dlq.getJobs(['waiting','failed','delayed'], 0, 50);
    const summary = jobs.map(j => ({
      id: j.id, name: j.name, failedAt: j.finishedOn,
      error: j.failedReason, attempts: j.attemptsMade,
      data: { accountId: j.data?.accountId, eventType: j.data?.eventType, meta: j.data?.meta },
    }));
    res.json({ count: summary.length, jobs: summary });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- DLQ: replay a failed job (admin only) ---
app.post('/debug/dlq/replay', requireAdminTokenMw, async (req, res) => {
  const jobId = req.query.id;
  if (!jobId) return res.status(400).json({ error: 'jobId required (?id=...)' });
  try {
    const { Queue } = await import('bullmq');
    const REDIS = { host: process.env.REDIS_HOST || '127.0.0.1', port: 6379, maxRetriesPerRequest: null };
    const dlq    = new Queue('wa-dlq',     { connection: REDIS });
    const events = new Queue('wa-events',  { connection: REDIS });
    const job    = await dlq.getJob(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found in DLQ: ' + jobId });
    await events.add(job.name, job.data, {
      attempts: 12, backoff: { type: 'exponential', delay: 5000 },
    });
    await job.remove();
    res.json({ ok: true, replayed: jobId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Queue depth summary (admin only) ---
app.get('/debug/queue-stats', requireAdminTokenMw, async (req, res) => {
  try {
    const { Queue } = await import('bullmq');
    const REDIS = { host: process.env.REDIS_HOST || '127.0.0.1', port: 6379, maxRetriesPerRequest: null };
    const [evQ, dlq] = [new Queue('wa-events', { connection: REDIS }), new Queue('wa-dlq', { connection: REDIS })];
    const [evC, dlqC] = await Promise.all([
      evQ.getJobCounts('waiting','active','delayed','failed'),
      dlq.getJobCounts('waiting','active','failed'),
    ]);
    res.json({
      'wa-events': evC,
      'wa-dlq': dlqC,
      ts: new Date().toISOString(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Saving store...');
  try { store.writeToFile(STORE_FILE); } catch (e) { console.error(e); }
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Saving store...');
  try { store.writeToFile(STORE_FILE); } catch (e) { console.error(e); }
  process.exit(0);
});
