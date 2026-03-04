// index.js
import 'dotenv/config';
import express from "express";
import cors from "cors";
import fs from "fs";
import path from 'path';
import crypto from 'crypto';
import twilio from 'twilio'; // Twilio Import
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { acquireLock } from './lock.js';
import { enqueueRetry } from './queues/retryDial.js';

// ... existing imports ...

import pino from "pino";
import qrcode from "qrcode-terminal";
import fetch from "node-fetch";
import { GoogleAuth } from "google-auth-library";

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
          android: {
            priority: 'high'
          },
          apns: {
            headers: { 'apns-priority': '10' }
          }
        }
      })
    });
    
    if (!response.ok) {
      const errText = await response.text();
      console.error('[FCM] Push failed:', response.status, errText);
    } else {
      console.log('[FCM] Push sent successfully to', deviceToken.substring(0, 15) + '...');
    }
  } catch (err) {
    console.error('[FCM] Error sending push:', err);
  }
}

/* ========== Structured Logger (pino JSON) ========== */
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  base: { service: 'superparty-backend', env: process.env.NODE_ENV || 'production' },
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: { colorize: true }
  } : undefined,
});

/* ========== Prometheus Metrics (prom-client) ========== */
import promClient from 'prom-client';

const metricsRegistry = new promClient.Registry();
promClient.collectDefaultMetrics({ register: metricsRegistry });

const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [metricsRegistry],
});

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

const whatsappMessagesTotal = new promClient.Counter({
  name: 'whatsapp_messages_total',
  help: 'Total WhatsApp messages processed',
  labelNames: ['direction'],
  registers: [metricsRegistry],
});

const canonicalMismatchTotal = new promClient.Counter({
  name: 'canonical_mismatch_total',
  help: 'DB writes where convoId did not match canonical JID (indicates amestec risk)',
  labelNames: ['route'],
  registers: [metricsRegistry],
});

/**
 * Anti-amestec: log + guardrail for every media operation.
 * Increments canonical_mismatch_total if convoId doesn't match expected canonical form.
 */
function logMediaOp(route, { inputJid, canonicalJid, accountId, convoId, msgId, storagePath, requestId }) {
  const expected = accountId ? `${accountId}_${canonicalJid}` : canonicalJid;
  const mismatch = convoId && convoId !== expected;
  if (mismatch) {
    canonicalMismatchTotal.inc({ route });
    logger.warn({ route, inputJid, canonicalJid, accountId, convoId, expected, msgId, storagePath, requestId, mismatch: true },
      `[CANONICAL MISMATCH] convoId="${convoId}" != expected="${expected}"`);
  } else {
    logger.info({ route, inputJid, canonicalJid, accountId, convoId, msgId, storagePath, requestId, mismatch: false },
      `[MediaOp] ${route}`);
  }
  return mismatch;
}
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
// ── Supabase DB adapter (replaces legacy auth/DB) ──

import { SessionManager } from "./session-manager.js"; // Import SessionManager

import * as Sentry from '@sentry/node';
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

// ── In-memory registry of VoIP client identities (populated by registerDevice) ──
const registeredVoipClients = new Map(); // Map<identity, { userId, deviceId, registeredAt }>

// ── Load device tokens from Supabase on startup (survives PM2 restarts) ──
async function loadDeviceTokensFromDB() {
  try {
    const { data, error } = await supabase
      .from('device_tokens')
      .select('device_identity, user_id, device_id, fcm_token, last_seen_at')
      .order('last_seen_at', { ascending: false });
    if (error) {
      console.error('[VoIP DB] Failed to load device_tokens:', error.message);
      return;
    }
    if (data && data.length > 0) {
      for (const row of data) {
        registeredVoipClients.set(row.device_identity, {
          userId: row.user_id,
          deviceId: row.device_id,
          fcmToken: row.fcm_token,
          registeredAt: row.last_seen_at
        });
      }
      console.log(`[VoIP DB] Loaded ${data.length} device(s) from Supabase into registry`);
    } else {
      console.log('[VoIP DB] No device_tokens found in Supabase');
    }
  } catch (e) {
    console.error('[VoIP DB] Exception loading device_tokens:', e.message);
  }
}
// Run on startup (non-blocking)
loadDeviceTokensFromDB();

// ── WebSocket Server Init ──
const wss = new WebSocketServer({ noServer: true });

// Heartbeat
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// WS Connection Handler
wss.on('connection', (ws, req, clientInfo) => {
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'register') {
        const { identity, deviceNumber, fcmToken } = msg; // Flutter app passes identity (e.g., admin)
        if (!identity) {
          return ws.send(JSON.stringify({ type: 'error', message: 'Missing identity' }));
        }

        // Store active WS in memory
        registeredVoipClients.set(identity, {
          ws,
          lastPing: Date.now(),
          deviceNumber: deviceNumber || null,
          fcmToken: fcmToken || 'WS_ONLY', // We keep FCM if the device sent it, fallback to WS_ONLY
          userId: clientInfo?.userId,
          registeredAt: new Date().toISOString()
        });

        console.log(`[VoIP WS] Registered active connection for identity: ${identity}`);
        ws.send(JSON.stringify({ type: 'registered', identity }));
      }
    } catch(e) {
      console.error('[VoIP WS] Message parse error:', e);
    }
  });

  ws.on('close', () => {
    for (const [id, entry] of registeredVoipClients.entries()) {
      if (entry.ws === ws) {
        // Only removing the WS reference from memory, keeping FCM tokens around
        console.log(`[VoIP WS] Connection closed for identity: ${id}`);
        // We do not delete the memory block entirely so Push works. Just nullify WS.
        entry.ws = null;
      }
    }
  });
});

// Helper for HTTP to WS Push Delivery
function sendIncomingToIdentity(identity, payload) {
  const entry = registeredVoipClients.get(identity);
  if (entry && entry.ws && entry.ws.readyState === 1 /* OPEN */) { // ws module uses numeric states
    console.log(`[VoIP WS] Delivering incoming call via WebSocket to: ${identity}`);
    entry.ws.send(JSON.stringify({ type: 'incoming_call', ...payload }));
    return true;
  }
  return false;
}

/* ========== Supabase DB Init ========== */
import { supabase, initDB, syncMessage, uploadMediaToStorage, getSignedMediaUrl, setCanonicalMismatchCallback } from "./supabase-sync.mjs";
import multer from "multer";
const upload = multer({ limits: { fileSize: 25 * 1024 * 1024 }, storage: multer.memoryStorage() });

// Init immediately
const db = initDB(); 

// Wire anti-amestec callback: increment Prometheus counter on canonical mismatch
setCanonicalMismatchCallback((route, details) => {
  canonicalMismatchTotal.inc({ route });
  logger.warn({ ...details, route, mismatch: true }, `[CANONICAL MISMATCH] in ${route}`);
});

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
// Inject resolveCanonicalJid so inbound messages are canonicalized before DB write
sessionManager._resolveCanonicalJid = resolveCanonicalJid;
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

// ── WS Token Auth Endpoint ──
app.get('/api/auth/get-ws-token', async (req, res) => {
  try {
    // Basic validation. Assuming client sends its identity (phone/device).
    // It's safer to use Firebase auth middleware if you have it applied here.
    // If not, we just issue a token for the requested identity from headers or body.
    const identity = req.query.identity || req.headers['x-identity'] || 'unknown_device';
    // Generate short-lived token for WebSocket authentication
    const token = jwt.sign(
      { identity, userId: identity },
      process.env.WS_JWT_SECRET || 'superparty_ws_secret_123',
      { expiresIn: '15m' }
    );
    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Boot Safety ─────────────────────────────────────────
try { fs.mkdirSync(path.join(process.cwd(), 'public', 'media'), { recursive: true }); } catch {}

// ─── Admin Token Middleware ──────────────────────────────
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
if (!ADMIN_TOKEN) logger.warn('⚠️ ADMIN_TOKEN not set — admin endpoints will reject all requests');
function requireAdminToken(req, res, next) {
  // Allow token via header or query param
  const auth = req.headers.authorization;
  const qToken = req.query.token;
  const token = (auth && auth.startsWith('Bearer ') ? auth.split('Bearer ')[1] : null) || qToken;
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid admin token' });
  }
  next();
}

// ─── Rate Limiter for regenerate ─────────────────────────
const _regenRateLimit = new Map();
const RATE_WHITELIST = new Set(['127.0.0.1', '::1']);

function regenRateLimit(req, res, next) {
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0];
  const ip = (fwd && fwd.trim()) || req.ip || req.connection?.remoteAddress || 'unknown';
  const accountId = req.params?.id || req.body?.accountId || 'GLOBAL';
  const key = `${ip}:${accountId}`;

  if (RATE_WHITELIST.has(ip)) return next();

  const now = Date.now();
  const WINDOW_MS = 60_000;
  const MAX_PER_WINDOW = 50;

  let entry = _regenRateLimit.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    _regenRateLimit.set(key, entry);
  }
  entry.count++;

  logger.info({ ip, accountId, count: entry.count, windowStart: entry.windowStart }, '[regenRateLimit]');

  if (entry.count > MAX_PER_WINDOW) {
    const retryAfterMs = WINDOW_MS - (now - entry.windowStart);
    return res.status(429).json({
      error: 'rate_limited',
      message: 'Too many requests. Wait 60s.',
      retryAfterMs
    });
  }
  next();
}

/* ========== RequestId + Metrics Middleware ========== */
app.use((req, res, next) => {
  // Generate or propagate requestId
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  // Timing
  const startTime = process.hrtime.bigint();

  // Log + metrics on response finish
  res.on('finish', () => {
    const durationNs = Number(process.hrtime.bigint() - startTime);
    const durationS = durationNs / 1e9;
    const routePath = req.route?.path || req.path || req.url;

    // Prometheus metrics
    httpRequestsTotal.inc({ method: req.method, path: routePath, status: res.statusCode });
    httpRequestDuration.observe({ method: req.method, path: routePath }, durationS);

    // Structured JSON log
    logger.info({
      requestId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: Math.round(durationS * 1000),
      ip: req.ip || req.connection?.remoteAddress,
    }, `${req.method} ${req.url} ${res.statusCode} ${Math.round(durationS * 1000)}ms`);
  });

  next();
});

/* ========== Twilio Config (from env only — no hardcoded secrets) ========== */
const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_TOKEN = process.env.TWILIO_TOKEN;
const API_KEY_SID = process.env.TWILIO_API_KEY_SID;
const API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET;
const TWIML_APP_SID = process.env.TWIML_APP_SID;
if (!TWILIO_SID || !TWILIO_TOKEN) logger.warn('⚠️ TWILIO_SID/TWILIO_TOKEN not set — Twilio calls will fail');
const twilioClient = (TWILIO_SID && TWILIO_TOKEN) ? twilio(TWILIO_SID, TWILIO_TOKEN) : null;

/* ========== Twilio Webhook ========== */
// Add urlencoded for Twilio
app.use(express.urlencoded({ extended: true }));


app.post('/api/voice/incoming', async (req, res) => {
  const { From, To, CallSid } = req.body;
  
  // LOOP PREVENTION: If Twilio dials the GSM client and the client's carrier forwards it back to our Centrala,
  // the From will be our own Twilio number. We MUST drop this to prevent ringing the agents twice!
  if (From === '+40373805828' || From === '+40373810882' || From === To) {
    console.warn(`[Twilio] LOOP DETECTED! Dropping forwarded call From: ${From} To: ${To}`);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.reject();
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  console.log(`[Twilio] Incoming Voice Request. From: ${From}, To: ${To}, SID: ${CallSid}`);

  // 1. Log to Supabase (Temporarily disabled due to Firebase SDK removal)
  try {
    if (From && To && CallSid) {
      // NOTE: use Supabase REST or SDK integration here if you want active history
      console.log(`[Twilio Calls] Would log ringing for CallSid: ${CallSid}`);
    }
  } catch(e) { console.error('Error logging call:', e); }

  const twiml = new twilio.twiml.VoiceResponse();
  const BASE_URL = process.env.PUBLIC_URL || 'http://46.225.182.127:3001';

  // 3. Routing Logic
  // Outbound: From starts with 'client:', OR is a known SDK identity (no '+' prefix = not a phone number)
  const isOutbound = From && (From.startsWith('client:') || !From.startsWith('+'));
  if (isOutbound) {
      // OUTGOING CALL (From Mobile App -> To external number)
      // NOTE: NO compliance message here — it causes the SDK session to timeout before connecting
      console.log(`[Twilio] Handling Outgoing Call from App (${From}) to: ${To}`);

      const CALLER_ID = '+40373805828'; // Your Twilio Number

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
          
          // Also mark the Supabase record as answered
          try {
             // Disabled legacy firestore integration
             console.log(`[Supabase Bridge] Would update status to answered for ${targetCallSid}`);
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
               timeout: 60,
               // NOTE: no `action` URL — returning non-TwiML from action causes immediate hangup
             });
             dial.number(target);
          } else {
             twiml.say({ language: 'ro-RO' }, 'Numărul format este incorect.');
          }
      }
  } else {
      // INCOMING CALL (From World -> To Mobile App)
      console.log(`[Twilio] Handling Incoming Call to App from: ${From}`);

      // Generate a conference name based on the incoming CallSid
      const confName = `conf_${CallSid}`;
      
      // Short greeting
      twiml.say({ language: 'ro-RO' }, 'Vă conectăm acum. Vă rugăm să aşteptaţi.');
      
      // Log incoming call to Supabase
      try {
         // Disabled legacy firestore integration
         console.log(`[Supabase Bridge] Would log active_incoming_call for ${CallSid}`);
      } catch(e) {} /* stub no-op */ 

      // Query registered VoIP clients from in-memory registry
      // Get the single most recently active client to prevent multiple overlapping calls
      let identities = [];
      for (const [id, info] of registeredVoipClients) {
        identities.push({ id, ...info });
      }
      identities.sort((a, b) => new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime());
      
      let targetClient = identities.length > 0 ? identities[0] : null;

      if (!targetClient) {
        console.warn('[Twilio] In-memory registry empty, loading from Supabase...');
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
            console.log(`[Twilio] Recovered client from Supabase: ${targetClient.id}`);
          }
        } catch (e) {
          console.error('[Twilio] DB fallback failed:', e.message);
        }
      }

      console.log(`[Twilio] Target VoIP client: ${targetClient ? targetClient.id : 'NONE'}`);
      
      if (!targetClient) {
        console.warn('[Twilio] No VoIP clients registered! Hanging up.');
        twiml.say({ language: 'ro-RO' }, 'Ne cerem scuze, niciun agent nu este disponibil in acest moment.');
      } else {
        // Build the <Dial> verb to ring the single active client
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

        // Dial the specific client
        dial.client(targetClient.id);

        // 1. Try WebSocket Delivery First 
        const deliveredViaWs = sendIncomingToIdentity(targetClient.id, payload);
        
        if (deliveredViaWs) {
          console.log(`[Twilio] Woke client ${targetClient.id} instantly via WebSocket`);
        } else if (targetClient.fcmToken && targetClient.fcmToken !== 'WS_ONLY') {
          // 2. Fallback to FCM Push Delivery if WS unavailable
          console.log(`[Twilio] Sending FCM Push to wake client: ${targetClient.id}`);
          sendFcmPush(targetClient.fcmToken, payload);
        }
      }
    }

  // Log TwiML for debugging
  console.log('[Twiml OUT]', twiml.toString());
  res.type('text/xml');
  res.send(twiml.toString());
});

// ─── FCM FALLBACK: LEGACY ENDPOINTS RESTORED ──────────────────────────────
// Enhanced /api/voice/accept with robust logging, validation, and distributed Redlock
app.post('/api/voice/accept', express.json(), async (req, res) => {
  try {
    console.log('[/api/voice/accept] incoming body:', JSON.stringify(req.body));
    const { conf, callSid, deviceNumber, sig } = req.body || {};

    if (!conf || !callSid) {
      console.warn('[/api/voice/accept] missing conf or callSid', { conf, callSid });
      return res.status(400).json({ ok: false, error: 'missing conf or callSid' });
    }

    const lock = await acquireLock(`accept:${callSid}`, 120000);
    try {
      let toNumber = deviceNumber;
      if (toNumber === 'SuperpartyApp' || !toNumber) {
        const clientIdentity = req.body.clientIdentity || req.body.deviceIdentity;
        if (clientIdentity) {
           toNumber = clientIdentity;
           console.log('[/api/voice/accept] Overriding generic SuperpartyApp deviceNumber with actual clientIdentity', { clientIdentity, toNumber });
        } else if (registeredVoipClients && registeredVoipClients.has(clientIdentity)) {
          const entry = registeredVoipClients.get(clientIdentity);
          toNumber = entry.deviceNumber || entry.device_number || clientIdentity;
          console.log('[/api/voice/accept] resolved deviceNumber from registry', { clientIdentity, toNumber });
        }
      }

      if (!toNumber) {
        console.warn('[/api/voice/accept] no deviceNumber available (no payload and not in registry).');
        return res.status(400).json({ ok: false, error: 'no deviceNumber provided or resolvable' });
      }

      console.log('[/api/voice/accept] creating Twilio call to', toNumber);
      // Auto-prefix VoIP clients if missing 'client:' because our Flutter SDK registers as "client:SuperpartyApp"
      if (!toNumber.includes('+') && !toNumber.startsWith('client:')) {
        toNumber = `client:${toNumber}`;
        console.log('[/api/voice/accept] auto-prepended client: prefix =>', toNumber);
      }
      let call;
      try {
        call = await twilioClient.calls.create({
          to: toNumber,
          from: process.env.TWILIO_CALLER_ID || '+40373805828',
          url: `${process.env.PUBLIC_URL || 'http://89.167.115.150:3001'}/api/voice/join-conference?conf=${encodeURIComponent(conf)}`
        });
        console.log('[/api/voice/accept] Twilio call created', { sid: call && call.sid });
      } catch (err) {
        console.error('[/api/voice/accept] Twilio calls.create error', err && err.code, err && err.message);
        return res.status(500).json({ ok: false, error: 'twilio_call_create_failed', detail: (err && err.message) || String(err) });
      }

      return res.json({ ok: true, callSid: call.sid });
    } finally {
      await lock.release().catch(e => console.error('[Redlock] release failed', e.message));
    }
  } catch (err) {
    console.error('[/api/voice/accept] unexpected error', err && err.stack);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

// ─── HANGUP PROPAGATION: KILL THE CONFERENCE AND COLLAPSE CLIENT UI ──────────
app.post('/api/voice/hangup', express.json(), async (req, res) => {
  const { conf, callSid, by } = req.body || {};
  if (!conf && !callSid) {
    return res.status(400).json({ ok: false, error: 'missing conf or callSid' });
  }

  try {
    const confName = conf || `conf_${callSid}`;
    console.log('[/api/voice/hangup] Terminating Conference', confName, 'Triggered by:', by || 'unknown');

    try {
      if (twilioClient) {
        await twilioClient.conferences(confName).update({ status: 'completed' });
        console.log('[/api/voice/hangup] Twilio Conference Completed Successfully Formally.');
      }
    } catch (restErr) {
      console.warn('[/api/voice/hangup] Twilio Conference could not be updated (may already be empty or invalid)', restErr && restErr.message);
    }

    // Broadcast `call_closed` event to WS registry so Flutter collapses the ringing UI
    if (wss && wss.clients) {
      const payload = JSON.stringify({ type: 'call_closed', conf: confName, by: by || 'server_hangup' });
      wss.clients.forEach(c => {
        if (c.readyState === 1 && c.identity) {
          c.send(payload);
        }
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[/api/voice/hangup] Fatal error closing call', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/voice/join-conference', express.urlencoded({ extended: false }), (req, res) => {
  console.log('[/api/voice/join-conference] conf:', req.query.conf);
  const twilio = require('twilio');
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  const dial = twiml.dial();
  dial.conference({
    startConferenceOnEnter: true,
    endConferenceOnExit: true
  }, req.query.conf);
  console.log('[/api/voice/join-conference] TwiML OUT:', twiml.toString());
  res.type('text/xml').send(twiml.toString());
});

app.post('/api/voice/dial-status', (req, res) => {
  try {
    const twilio = require('twilio');
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const dialStatus = (req.body.DialCallStatus || '').toLowerCase();
    const twiml = new VoiceResponse();
    console.log(`[Twilio] Dial Status: \${dialStatus}, CallSid: \${req.body.CallSid}`);
    
    // success -> nothing to do
    if (dialStatus === 'completed') return res.type('text/xml').send(twiml.toString());

    // Asynchronous Queue Fallback instead of immediate duplicate Ringing
    if (dialStatus === 'no-answer' || dialStatus === 'failed') {
      const conf = req.body.DialCallSid || `conf_${req.body.CallSid}`;
      
      // Determine what to ring
      let toNumber = null;
      const clientIdentity = req.body.clientIdentity || req.body.CallerClientIdentity || req.body.ToClientIdentity;
      if (clientIdentity && registeredVoipClients.has(clientIdentity)) {
        toNumber = registeredVoipClients.get(clientIdentity).deviceNumber;
      }

      if (toNumber) {
        console.log(`[Queueing Retry] BullMQ scheduled to retry Dialing ${toNumber}`);
        enqueueRetry(conf, toNumber, 1);
        twiml.say({ language: 'ro-RO' }, 'Așteptați. Încercăm să vă conectăm din nou.');
        return res.type('text/xml').send(twiml.toString());
      }
    }

    // final fallback: transfer to operator (if queue omitted or after attempts)
    const finalOperator = process.env.OPERATOR_NUMBER || process.env.TWILIO_CALLER_ID || '+40373805828';
    twiml.say({ language: 'ro-RO' }, 'Ne pare rău, nu am reușit să vă conectăm. Vă transferăm la operator.');
    twiml.dial({ callerId: process.env.TWILIO_CALLER_ID || finalOperator }).number(finalOperator);
    return res.type('text/xml').send(twiml.toString());
  } catch (err) {
    console.error('[dial-result] error', err);
    const VoiceResponse = require('twilio').twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    twiml.say({ language: 'ro-RO' }, 'Eroare internă. Încercați din nou mai târziu.');
    return res.type('text/xml').status(200).send(twiml.toString());
  }
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

// ─── HELPER: Generare ID Unic Conferinta ──────────────────────────────────────────
function makeConfName() {
  return `conf_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
}

// ─── REST Callback: apelează clientul şi agentul simultan într-o Conferinţă ────────
app.post('/api/voice/callback', async (req, res) => {
  try {
    const { to, agentIdentity, callerId } = req.body;
    if (!to) return res.status(400).json({ error: 'Missing `to` phone number' });

    // Folosim callerId trimis de Flutter (care extrage numărul destinație original, ex: +4037...)
    const { validateCallerId } = require('/tmp/caller_allow.js');
    const CALLER_ID = validateCallerId(callerId);
    const BASE_URL  = process.env.PUBLIC_URL || 'http://46.225.182.127:3001';

    // Fetch the agent identity from Supabase if not provided
    let identity = agentIdentity;
    if (!identity) {
      console.warn(`[Callback-Conf] No agentIdentity provided. Falling back to in-memory registry.`);
      const activeClients = Array.from(registeredVoipClients.keys());
      identity = activeClients[0] || 'superparty_admin';
      console.warn(`[Callback-Conf] No agentIdentity provided. Attempting to resolve from Supabase or in-memory registry.`);
      if (db) {
        // Attempt to fetch an active agent from Supabase
        const activeAgentSnap = await db.collection('voip_clients').where('status', '==', 'online').limit(1).get();
        if (!activeAgentSnap.empty) {
          identity = activeAgentSnap.docs[0].id; // Assuming the document ID is the identity
          console.log(`[Callback-Conf] Resolved agentIdentity from Supabase: ${identity}`);
        }
      }

      if (!identity && registeredVoipClients && registeredVoipClients.size > 0) {
        // Fallback to in-memory registry
        identity = Array.from(registeredVoipClients.keys())[0];
        console.log(`[Callback-Conf] Resolved agentIdentity from in-memory registry: ${identity}`);
      }

      if (!identity) {
        identity = 'superparty_admin'; // Final fallback
        console.warn(`[Callback-Conf] No active agent found. Falling back to default: ${identity}`);
      }
    }

    const confName = makeConfName();
    console.log(`[Callback-Conf] Initiating Conference: ${confName} | Agent: ${identity} | Client: ${to}`);

    // Endpoint-ul de join în conferință pentru ambele call-uri
    const joinUrl = `${BASE_URL}/api/voice/joinConference?name=${encodeURIComponent(confName)}`;

    // 1. Call Client (GSM)
    const clientCall = await twilioClient.calls.create({
      to: to,
      from: CALLER_ID,
      url: joinUrl,
      timeout: 60,
      record: true,
      recordingStatusCallback: `${BASE_URL}/api/voice/recording-status`,
      recordingStatusCallbackMethod: 'POST',
      statusCallback: `${BASE_URL}/api/voice/status?conf=${encodeURIComponent(confName)}&role=client`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST'
    });

    // 2. Call Agent (VoIP)
    const agentCall = await twilioClient.calls.create({
      to: `client:${identity}`,
      from: to,
      url: joinUrl,
      timeout: 60,
      statusCallback: `${BASE_URL}/api/voice/status?conf=${encodeURIComponent(confName)}&role=agent`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST'
    });

    console.log(`[Callback-Conf] Dispatch OK! Client SID: ${clientCall.sid} | Agent SID: ${agentCall.sid}`);

    const metadata = {
      confName,
      from: to,
      to,
      agentIdentity: identity,
      direction: 'outgoing',
      status: 'ringing',
      clientCallSid: clientCall.sid,
      agentCallSid: agentCall.sid,
      timestamp: new Date().toISOString()
    };

    // Logging to Supabase
    await db.collection('calls').doc(confName).set(metadata);
    await db.collection('voiceConfs').doc(confName).set(metadata);

    res.json({ success: true, confName, clientCallSid: clientCall.sid, agentCallSid: agentCall.sid });
  } catch (e) {
    console.error('[Callback-Conf] Error creating conference:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── TwiML: aruncă participanții în conferință când răspund ───────────────────────
app.post('/api/voice/joinConference', (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).send('missing conference name');

  console.log(`[JoinConference] Participant joined: ${name}`);

  const twiml = new twilio.twiml.VoiceResponse();
  const dial = twiml.dial();
  dial.conference({
    beep: false,
    startConferenceOnEnter: true,
    endConferenceOnExit: true, // when the first participant to join the conference drops, it ends for everyone.
    waitUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.ambient'
  }, name);

  res.type('text/xml');
  res.send(twiml.toString());
});

// ─── Call Log: Cancel an outgoing REST call and its bridged child legs ──────────
// Deprecated/Adapted for Conference App
app.delete('/api/voice/callback/:sid', async (req, res) => {
  try {
    // If we receive the ConfName or CallSid, we just kill the conference legs if we can find them
    const sid = req.params.sid;
    console.log(`[Callback-Conf] Force hanging up: ${sid}`);
    
    let targetConfId = sid;
    
    // Check if it's a CallSid or a ConfName
    if (sid.startsWith('CA')) {
       try {
         await twilioClient.calls(sid).update({ status: 'completed' });
       } catch(e) {}
    } else if (sid.startsWith('conf_')) {
       try {
          const doc = await db.collection('voiceConfs').doc(sid).get();
          if (doc.exists) {
             const data = doc.data();
             if (data.clientCallSid) await twilioClient.calls(data.clientCallSid).update({ status: 'completed' }).catch(console.error);
             if (data.agentCallSid) await twilioClient.calls(data.agentCallSid).update({ status: 'completed' }).catch(console.error);
          }
       } catch(e) {}
    }

    res.json({ success: true, message: 'Force cancel triggered' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});



// ── Call Log: Save every inbound call to Supabase ────────────────────────────
app.post('/api/voice/status', async (req, res) => {
  const { CallSid, CallStatus, From, To, CallDuration, StartTime, EndTime } = req.body;
  const { conf, role } = req.query; // NEW: Track the conference legs
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
      startTime: StartTime ? new Date(StartTime) : new Date().toISOString(),
      endTime: EndTime ? new Date(EndTime) : null,
      timestamp: new Date().toISOString(),
    }, { merge: true });
    console.log(`[CallLog] Saved call to Supabase`);

    // --- NEW: Mutual Conference Teardown Logic ---
    if (conf && role && ['completed', 'failed', 'canceled', 'no-answer', 'busy'].includes(CallStatus)) {
      console.log(`[Conference-Teardown] Terminal state (${CallStatus}) reached for ${role} on ${conf}. Tearing down other leg...`);
      const confDoc = await db.collection('voiceConfs').doc(conf).get();
      if (confDoc.exists) {
        const data = confDoc.data();
        const otherLegSid = (role === 'agent') ? data.clientCallSid : data.agentCallSid;
        if (otherLegSid) {
          try {
            await twilioClient.calls(otherLegSid).update({ status: 'completed' });
            console.log(`[Conference-Teardown] Successfully canceled ${role}'s counterpart: ${otherLegSid}`);
          } catch (cancelErr) {
             if (!cancelErr.message.includes('already completed') && !cancelErr.message.includes('not in-progress')) {
               console.error(`[Conference-Teardown] Failed to cancel ${otherLegSid}:`, cancelErr.message);
             }
          }
        }
      }
    }
  } catch (e) {
    console.error('[CallLog] Failed to save call log:', e.message);
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
    // Convert Timestamps to ISO strings for JSON
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
  if (!userId || !deviceId) {
    return res.status(400).send('Missing required fields: userId, deviceId');
  }

  // Identity logically requested by other parts of the system
  const identity = `user_${userId}_dev_${deviceId}`;
  try {
    const now = new Date().toISOString();
    // 1) Store in in-memory registry
    registeredVoipClients.set(identity, { userId, deviceId, fcmToken, registeredAt: now });

    // 2) Persist to Supabase (upsert on device_identity)
    const { error: dbError } = await supabase
      .from('device_tokens')
      .upsert({
        device_identity: identity,
        user_id: userId,
        device_id: deviceId,
        fcm_token: fcmToken || null,
        device_token: fcmToken || null,
        platform: 'android',
        last_seen_at: now,
      }, { onConflict: 'device_identity' });

    if (dbError) {
      console.error('[VoIP DB] Supabase upsert error:', dbError.message);
      // Still return OK — in-memory registration worked
    } else {
      console.log(`[VoIP DB] ✅ Persisted device ${identity} to Supabase`);
    }

    console.log(`[Twilio VoIP] Registered device ${deviceId} for user ${userId} with identity: ${identity}`);
    console.log(`[Twilio VoIP] Total registered clients: ${registeredVoipClients.size}`);
    res.json({ identity });
  } catch (error) {
    console.error("[Twilio VoIP] Error registering device:", error);
    res.status(500).send('Internal Server Error');
  }
});

// ── Debug endpoint: list registered VoIP clients ──
app.get('/debug/voip/clients', (req, res) => {
  const clients = [];
  for (const [identity, info] of registeredVoipClients) {
    clients.push({ identity, ...info });
  }
  res.json({ count: clients.length, clients });
});

// MULTI-DEVICE: Fetch token scoped to a specific device identity
app.get('/api/voice/getVoipToken', async (req, res) => {
  const { userId, deviceId } = req.query;
  if (!userId || !deviceId) {
    return res.status(400).send('Missing required query params: userId, deviceId');
  }
  
  try {
    // Query identity from DB instead of reconstructing it, to avoid token mismatch.
    let identity = `user_${userId}_dev_${deviceId}`; // fallback base
    const { data: dbIdentity, error: idErr } = await supabase.from('device_tokens')
      .select('device_identity')
      .eq('user_id', userId)
      .eq('device_id', deviceId)
      .maybeSingle();
      
    if (dbIdentity && dbIdentity.device_identity) {
      identity = dbIdentity.device_identity;
    }

    // Also register in VoIP client map (so incoming calls can find this device)
    registeredVoipClients.set(identity, { userId, deviceId, registeredAt: new Date().toISOString() });
    console.log(`[Twilio VoIP] Generating token for identity: ${identity} (total clients: ${registeredVoipClients.size})`);

    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: TWIML_APP_SID,
      incomingAllow: true, // Allow incoming calls
    });

    const token = new AccessToken(
      TWILIO_SID,
      process.env.TWILIO_API_KEY_SID,
      process.env.TWILIO_API_KEY_SECRET,
      { identity: identity }
    );
    
    // PUSH CREDENTIAL: Required for VoIP push notifications (background calls).
    // Set PUSH_CREDENTIAL_SID env var from Twilio Console → Push Credentials.
    // Without a valid credential, calls only work when app is in foreground.
    const PUSH_CREDENTIAL_SID = process.env.PUSH_CREDENTIAL_SID || '';
    if (PUSH_CREDENTIAL_SID) {
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
  const terminalStates = ['canceled', 'completed'];
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
app.get('/debug/fetch-avatars/:docId', requireAdminToken, async (req, res) => {
  const { docId } = req.params;
  try {
    const result = await sessionManager.backfillProfilePictures(docId);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DEBUG: Trigger profile pic backfill
app.get('/debug/fetch-avatars/:docId', requireAdminToken, async (req, res) => {
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

// ─── POST /api/conversations — Create or find a conversation ───
// Called from Flutter when user taps "Open conversation on WhatsApp"
// Body: { phone: "+407...", accountId: "docId", label: "Client Name" }
// Returns: { conversationId, jid }
app.post("/api/conversations", async (req, res) => {
  const { phone, accountId, label } = req.body;
  console.log(`[OpenConvo] Request: phone=${phone} accountId=${accountId} label=${label}`);

  if (!phone || !accountId) {
    return res.status(400).json({ error: "phone and accountId are required" });
  }

  // 1) Normalize phone → JID
  let digits = String(phone).replace(/[^0-9]/g, '');
  // If starts with 0 and looks Romanian (10 digits), prepend 40
  if (digits.startsWith('0') && digits.length === 10) {
    digits = '40' + digits.substring(1);
  }
  // Remove leading + if it snuck through
  if (digits.startsWith('+')) digits = digits.substring(1);

  if (digits.length < 8 || digits.length > 15) {
    return res.status(400).json({ error: "invalid_phone", message: `Invalid phone number: ${phone}` });
  }

  const jid = digits + '@s.whatsapp.net';
  // ── Canonical JID: ensure we use the same ID as inbound messages ──
  const canonicalJid = resolveCanonicalJid(jid);
  const convoId = `${accountId}_${canonicalJid}`;
  console.log(`[OpenConvo] Normalized: jid=${jid} canonical=${canonicalJid} convoId=${convoId}`);

  // 2) Check session
  const session = sessionManager.sessions.get(accountId);
  if (!session || session.status !== 'connected') {
    return res.status(503).json({
      error: "no_active_session",
      accountId,
      message: "No active WhatsApp session for this account. Please scan QR first."
    });
  }

  try {
    // 3) Get or create conversation in Supabase
    const convoRef = db.collection('conversations').doc(convoId);
    const convoSnap = await convoRef.get();

    if (!convoSnap.exists) {
      console.log(`[OpenConvo] Creating new conversation: ${convoId}`);
      await convoRef.set({
        jid: canonicalJid,
        canonicalJid: canonicalJid,
        phone: '+' + digits,
        accountId,
        accountLabel: session.label || '',
        name: label || null,
        pushName: label || null,
        createdAt: new Date(),
        lastMessageAt: new Date(),
        lastMessagePreview: '',
        unreadCount: 0,
      });
    } else {
      console.log(`[OpenConvo] Conversation exists: ${convoId}`);
      // Update name/label if provided and different
      if (label) {
        await convoRef.set({ name: label, pushName: label }, { merge: true });
      }
    }

    console.log(`[OpenConvo] Success: conversationId=${convoId}`);
    return res.json({ conversationId: convoId, jid, canonicalJid });
  } catch (err) {
    console.error('[OpenConvo] Error:', err);
    return res.status(500).json({ error: "internal_error", message: err.message });
  }
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
  console.log(`[API Alias] POST /api/conversations/${jid}/messages -> Rewriting to /messages/${jid}`);
  req.url = `/messages/${encodeURIComponent(jid)}`;
  req.originalUrl = req.url;
  app.handle(req, res);
});

// --- JWT Helper (Unsafe Decode for MVP) ---
function getEmailFromToken(req) {
  // Return email from already-verified user (set by verifyToken middleware)
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
    // Replace base64url characters with base64 characters
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(Buffer.from(base64, 'base64').toString());
    return decoded.email || null;
  } catch (e) {
    return null;
  }
}

// ── Secure admin middleware: verifyIdToken + role check ────────────────
async function requireAdminSecure(req, res, next) {
  // 1. Try admin token (for CLI/scripts — should be rotated regularly)
  const auth = req.headers.authorization;
  const qToken = req.query.token;
  const token = (auth && auth.startsWith('Bearer ') ? auth.split('Bearer ')[1] : null) || qToken;
  if (token === ADMIN_TOKEN) return next();
  
  // 2. Verify Supabase JWT token (replaces legacy auth)
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing Bearer token' });
  }
  try {
    const idToken = auth.split('Bearer ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(idToken);
    if (error || !user) throw new Error(error?.message || 'Invalid token');
    const decoded = { uid: user.id, email: user.email, ...user.user_metadata };
    req.user = decoded;
    const email = decoded.email;
    
    // Master admin bypass
    if (email === 'ursache.andrei1995@gmail.com') return next();
    
    // Check employees collection for admin role
    const snap = await db.collection('employees').where('email', '==', email).limit(1).get();
    if (!snap.empty && snap.docs[0].data().role === 'admin') return next();
    
    return res.status(403).json({ error: 'forbidden', message: 'Admin role required' });
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized', message: 'Invalid token' });
  }
}

// ── Person Code Generator (atomic, case-insensitive unique) ────────────
// crypto already imported at top of file

async function generatePersonCode() {
  // Retry loop with uniqueness check (case-insensitive)
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = 'SP-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    // Case-insensitive check: DB is case-sensitive, so we store UPPERCASE only
    const dup = await db.collection('employees').where('personCode', '==', code).limit(1).get();
    if (dup.empty) return code;
  }
  // Fallback: 6-char code (65K possibilities)
  return 'SP-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

// ─── USER PHONE NUMBER UPDATE ──────────────────────────────────────────
app.post('/api/user/phone', express.json(), async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number missing' });

    // Update phone in supabase using the uid/email associated with the token auth
    const userEmail = req.user.email;
    if (!userEmail) return res.status(403).json({ error: 'No email in auth token' });

    const { error } = await supabase
      .from('employees')
      .update({ phone: phone })
      .eq('email', userEmail);

    if (error) throw error;
    res.json({ success: true, phone });
  } catch (err) {
    console.error('Error updating phone:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PRIVACY SETTINGS ─────────────────────────────────────────────────────
// ── Audit Logger ─────────────────────────────────────────────────────
async function auditLog(action, details) {
  try {
    await db.collection('audit_log').add({
      action,
      ...details,
      timestamp: new Date(),
    });
  } catch (e) {
    console.error('[Audit] Failed to write:', e.message);
  }
}

// DEPRECATED: Use requireAdminSecure instead.
// This middleware uses INSECURE JWT decode for the email check.
// Kept only for backward compat on routes that also accept ADMIN_TOKEN.
async function requireAdmin(req, res, next) {
  // First try admin token (for CLI/scripts)
  const auth = req.headers.authorization;
  const qToken = req.query.token;
  const token = (auth && auth.startsWith('Bearer ') ? auth.split('Bearer ')[1] : null) || qToken;
  if (token === ADMIN_TOKEN) return next();
  
  // Use secure verification
  return requireAdminSecure(req, res, next);
}

// ── Admin: Set/Change personCode ─────────────────────────────────────
app.post('/api/admin/set-code', requireAdmin, async (req, res) => {
  try {
    const { docId, personCode } = req.body;
    if (!docId || !personCode) return res.status(400).json({ error: 'docId and personCode required' });
    
    // Normalize: trim whitespace, keep original case
    const normalized = personCode.trim();
    if (normalized.length < 1 || normalized.length > 50) {
      return res.status(400).json({ error: 'Codul trebuie sa aiba intre 1 si 50 caractere' });
    }
    
    // Check uniqueness
    const dup = await db.collection('employees').where('personCode', '==', normalized).limit(1).get();
    if (!dup.empty && dup.docs[0].id !== docId) {
      return res.status(409).json({ error: 'code_taken', takenBy: dup.docs[0].data().displayName });
    }
    
    const docRef = db.collection('employees').doc(docId);
    const oldDoc = await docRef.get();
    const oldCode = oldDoc.exists ? oldDoc.data().personCode : null;
    
    await docRef.set({ personCode: normalized, updatedAt: new Date() }, { merge: true });
    await auditLog('personCode.changed', { oldCode, newCode: normalized, docId, adminEmail: getEmailFromToken(req) });
    
    console.log(`[PersonCode] Changed ${oldCode} -> ${normalized} for ${docId}`);
    res.json({ ok: true, personCode: normalized });
  } catch (e) {
    console.error('[Admin] set-code error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Admin: Toggle employee permission ────────────────────────────────
app.post('/api/admin/toggle-permission', requireAdmin, async (req, res) => {
  try {
    const { docId, permission, value } = req.body;
    if (!docId || !permission) return res.status(400).json({ error: 'docId and permission required' });
    
    const validPerms = ['canNoteEvents', 'canViewAllChats', 'canManageAccounts'];
    if (!validPerms.includes(permission)) {
      return res.status(400).json({ error: `Invalid permission. Valid: ${validPerms.join(', ')}` });
    }
    
    await db.collection('employees').doc(docId).set({ 
      [permission]: value === true,
      updatedAt: new Date() 
    }, { merge: true });
    
    await auditLog('permission.changed', { docId, permission, value, adminEmail: getEmailFromToken(req) });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


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
      displayName: data.displayName,
      personCode: data.personCode || null,
      permissions: {
        canNoteEvents: data.canNoteEvents === true,
        canViewAllChats: data.canViewAllChats === true,
        canManageAccounts: data.canManageAccounts === true,
      }
    });

  } catch (e) {
    console.error('Error in /employees/me:', e);
    // Fallback
    if (email === 'ursache.andrei1995@gmail.com') return res.json({ approved: true, role: 'admin', email, personCode: 'SP-ADMIN', permissions: { canNoteEvents: true, canViewAllChats: true, canManageAccounts: true } });
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




// --- Admin Employee Management ---
app.get('/api/employees', async (req, res) => {
  try {
     const snapshot = await db.collection('employees').where('approved', '==', true).get(); 
     const employees = [];
     snapshot.forEach(doc => {
         const d = doc.data();
         employees.push({ 
           docId: doc.id,
           displayName: d.displayName,
           email: d.email,
           role: d.role,
           personCode: d.personCode || null,
           permissions: {
             canNoteEvents: d.canNoteEvents === true,
             canViewAllChats: d.canViewAllChats === true,
             canManageAccounts: d.canManageAccounts === true,
           }
         });
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

app.post('/api/employees/:uid/approve', requireAdmin, async (req, res) => {
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

        // 2. Update Employee Doc (personCode set separately by admin)
        await docRef.set({ 
            approved: true,
            suspended: false, // Clear suspension
            role: 'employee',
            approvedAt: new Date()
        }, { merge: true });

        // 3. Set Custom Claim & CREATE USER PROFILE
        let authUid = empData.uid; // Try existing field
        console.log(`[Auth] Attempting claim for docId=${uid}, email=${email}, existingAuthUid=${authUid}`);
        
        // 3. CREATE USER PROFILE IN 'users' COLLECTION (if it doesn't exist)
        // This ensures the "Profile" exists as requested by user, using the employee docId as uid
        // In a Supabase context, this would typically be handled by a trigger or a separate user management flow
        // For now, we'll use the Firestore docId as a pseudo-UID for the 'users' collection.
        await db.collection('users').doc(uid).set({
           email: email,
           displayName: empData.displayName || '',
           phone: empData.phone || '',
           role: 'employee',
           approved: true,
           createdAt: empData.createdAt || new Date(),
           // photoURL: userRecord.photoURL || '', // No userRecord here
           uid: uid // Using the employee docId as the user uid
        }, { merge: true });
        console.log(`[Profile] Created/Updated user profile for ${uid}`);

        res.json({ status: 'approved', docId: uid, authUid: uid }); // Return docId as authUid for consistency
    } catch(e) {
        console.error("Error approving:", e);
        res.status(500).json({error: e.message});
    }
});

app.post('/api/employees/:uid/suspend', requireAdmin, async (req, res) => {
    try {
        const { uid } = req.params;
        await db.collection('employees').doc(uid).set({ 
            approved: false,
            suspended: true,
            suspendedAt: new Date()
        }, { merge: true });

        // Also update the 'users' collection if a profile exists
        await db.collection('users').doc(uid).set({
            approved: false,
            suspended: true,
        }, { merge: true });

        res.json({ status: 'suspended', uid });
    } catch(e) {
        console.error("Error suspending:", e);
        res.status(500).json({error: e.message});
    }
});

app.post('/api/employees/:uid/reject', requireAdmin, async (req, res) => {
    try {
        const { uid } = req.params;
        // 1. Update employee doc in Supabase/Firestore mock
        await db.collection('employees').doc(uid).set({ 
            approved: false, 
            rejectedAt: new Date()
        }, { merge: true });
        
        // 2. Reject the request
        res.json({ success: true, message: `Request for ${uid} rejected.` });
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
app.get("/debug/store-stats", requireAdminToken, (req, res) => {
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
  const sessions = [];
  const sessionsById = {};
  const summary = { connected: 0, needs_qr: 0, qr_ready: 0, regenerating: 0, reconnecting: 0, disconnected: 0, other: 0 };

  if (sessionManager && sessionManager.sessions) {
    sessionManager.sessions.forEach((val, key) => {
      const rstate = sessionManager._regeneratingState?.get(key);
      const entry = {
        docId: key,
        status: val.status,
        qr: !!val.qr,
        qrSeq: val.qrSeq || 0,
        qrUpdatedAt: val.qrUpdatedAt || null,
        phone: val.sock?.user?.id?.split(':')[0] || null,
        label: val.label || '',
        reconnectAttempts: val.reconnectAttempts || 0,
        pairingPhase: rstate?.phase || null,
        pairingStartedAt: rstate?.startedAt ? new Date(rstate.startedAt).toISOString() : null,
        reqId: val.reqId || rstate?.reqId || null,
        requiresQR: !val.sock && val.status === 'needs_qr',
      };
      sessions.push(entry);
      sessionsById[key] = entry;
      if (val.status === 'connected') summary.connected++;
      else if (val.status === 'needs_qr') summary.needs_qr++;
      else if (val.status === 'reconnecting') summary.reconnecting++;
      else if (val.status === 'disconnected') summary.disconnected++;
      else summary.other++;
      if (rstate) {
        if (rstate.phase === 'qr_ready') summary.qr_ready++;
        else if (rstate.phase === 'regenerating') summary.regenerating++;
      }
    });
  }

  res.json({
    status: "ok",
    mode: "multi-session",
    sessions,
    sessionsById,
    summary,
    metrics: sessionManager.metrics || {}
  });
});


// ======== Endpoint to expose the latest QR code for an account (by document ID) ========
app.get('/api/accounts/:id/qr', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  const docId = req.params.id;
  const s = sessionManager.sessions.get(docId);
  const rstate = sessionManager._regeneratingState?.get(docId);
  if (!s) return res.status(404).json({ error: 'Session not found', docId });
  res.json({
    docId,
    status: s.status,
    qr: s.qr || null,
    qrSeq: s.qrSeq || 0,
    qrUpdatedAt: s.qrUpdatedAt || null,
    state: rstate?.phase || (s.status === 'connected' ? 'connected' : 'idle'),
    reqId: s.reqId || rstate?.reqId || null,
  });
});

// --- Pairing UI (secured, JS polling, no auto-refresh, no auto-POST) ---
app.get("/pair", requireAdminToken, (req, res) => {
  const accountId = req.query.accountId || '';
  const token = (req.headers.authorization?.split('Bearer ')[1]) || req.query.token || '';

  res.set('Cache-Control', 'no-store');
  res.send(`<!DOCTYPE html>
<html><head>
  <title>WhatsApp QR Pairing</title>
  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"><\/script>
  <style>
    body { font-family: -apple-system, sans-serif; padding: 20px; background: #1a1a2e; color: #eee; }
    h1 { color: #e94560; }
    .status { padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: bold; display: inline-block; }
    .status-connected { background: #2ecc71; color: #000; }
    .status-needs_qr { background: #e67e22; color: #fff; }
    .btn { padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; margin: 5px; }
    .btn-regen { background: #e94560; color: #fff; }
    .btn-regen:disabled { background: #555; cursor: not-allowed; }
    .seq { font-size: 12px; color: #888; margin-top: 5px; }
    select { padding: 8px; border-radius: 8px; background: #16213e; color: #eee; border: 1px solid #333; }
  </style>
</head>
<body>
  <h1>WhatsApp QR Pairing</h1>
  <p>Select an account, click Regenerate, then scan with WhatsApp Linked Devices.</p>
  <div>
    <label>Account: </label>
    <select id="accountSelect"></select>
    <button class="btn btn-regen" id="regenBtn" onclick="doRegenerate()">Regenerate QR</button>
  </div>
  <div id="qr-display" style="margin-top:20px;"></div>
  <div id="status-display" style="margin-top:10px;"></div>
  <div id="all-accounts" style="margin-top:30px;"></div>

  <script>
    const TOKEN = '${token}';
    const BASE = window.location.origin;
    const headers = TOKEN ? { 'Authorization': 'Bearer ' + TOKEN } : {};
    let selectedAccount = '${accountId}';
    let currentQrSeq = 0;
    let polling = null;

    async function loadAccounts() {
      try {
        const r = await fetch(BASE + '/status');
        const d = await r.json();
        const sel = document.getElementById('accountSelect');
        sel.innerHTML = '<option value="">-- select --</option>';
        d.sessions.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.docId;
          opt.textContent = s.docId.substring(0,8) + '... [' + s.status + '] ' + (s.phone || '');
          if (s.docId === selectedAccount) opt.selected = true;
          sel.appendChild(opt);
        });
        const sum = d.summary || {};
        document.getElementById('all-accounts').innerHTML =
          '<h3>All Accounts</h3>' +
          '<p>Connected: ' + (sum.connected||0) +
          ' | Needs QR: ' + (sum.needs_qr||0) +
          ' | Reconnecting: ' + (sum.reconnecting||0) +
          ' | Disconnected: ' + (sum.disconnected||0) + '</p>';
      } catch(e) { console.error('loadAccounts error:', e); }
    }

    async function doRegenerate() {
      const acct = document.getElementById('accountSelect').value;
      if (!acct) return alert('Select an account first');
      selectedAccount = acct;
      const btn = document.getElementById('regenBtn');
      btn.disabled = true;
      btn.textContent = 'Regenerating...';
      try {
        const r = await fetch(BASE + '/api/accounts/' + acct + '/regenerate-qr', { method: 'POST', headers });
        const d = await r.json();
        document.getElementById('status-display').innerHTML = '<pre>' + JSON.stringify(d, null, 2) + '</pre>';
        startPolling(acct);
      } catch(e) {
        document.getElementById('status-display').innerHTML = '<p style="color:red">Error: ' + e.message + '</p>';
      }
      setTimeout(() => { btn.disabled = false; btn.textContent = 'Regenerate QR'; }, 10000);
    }

    function startPolling(acct) {
      if (polling) clearInterval(polling);
      currentQrSeq = 0;
      polling = setInterval(async () => {
        try {
          const r = await fetch(BASE + '/api/accounts/' + acct + '/qr', { headers });
          if (!r.ok) return;
          const d = await r.json();
          if (d.qr && d.qrSeq !== currentQrSeq) {
            currentQrSeq = d.qrSeq;
            const container = document.getElementById('qr-display');
            container.innerHTML = '<div id="qr-canvas"></div>';
            try {
              if (typeof QRCode !== 'undefined') {
                QRCode.toCanvas(document.createElement('canvas'), d.qr, {width: 300, margin: 2}, (err, canvas) => {
                  if (!err) document.getElementById('qr-canvas').appendChild(canvas);
                });
              } else { throw new Error('QRCode not loaded'); }
            } catch(e) {
              var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(d.qr);
              document.getElementById('qr-canvas').innerHTML = '<img src=\"' + qrUrl + '\" width=\"300\" height=\"300\" style=\"border-radius:8px;background:#fff;padding:8px\" />';
            }
            container.innerHTML += '<p class="seq">QR #' + d.qrSeq + ' | State: ' + d.state + '</p>';
          }
          document.getElementById('status-display').innerHTML =
            '<p>Status: <span class="status status-' + d.status + '">' + d.status + '</span> | Phase: ' + (d.state||'idle') + '</p>';
          if (d.status === 'connected') {
            clearInterval(polling);
            document.getElementById('qr-display').innerHTML = '<h2 style="color:#2ecc71">CONNECTED!</h2>';
            loadAccounts();
          }
        } catch(e) { console.error('poll error:', e); }
      }, 2000);
    }

    document.getElementById('accountSelect').addEventListener('change', (e) => {
      selectedAccount = e.target.value;
      if (selectedAccount) startPolling(selectedAccount);
    });

    loadAccounts();
    if (selectedAccount) startPolling(selectedAccount);
  <\/script>
</body></html>`);
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
  const canonical = resolveCanonicalJid(jid) || jid;
  const requestId = req.id || req.headers['x-request-id'] || `media-${Date.now()}`;
  logMediaOp('GET /media/:jid/:id', { inputJid: jid, canonicalJid: canonical, accountId: null, convoId: null, msgId: id, storagePath: null, requestId });
  
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


/* ========== Signed URL Endpoint (on-demand, 1h expiry) ========== */
app.get("/api/media/url/:convoId/:msgId", verifyToken, async (req, res) => {
  const { convoId, msgId } = req.params;
  const requestId = req.id || req.headers['x-request-id'] || `signed-${Date.now()}`;

  try {
    // Look up message in Supabase to get storage path
    const msgDoc = await db.collection('conversations').doc(convoId).collection('messages').doc(msgId).get();
    if (!msgDoc.exists) return res.status(404).json({ error: 'message_not_found' });

    const data = msgDoc.data();
    const storagePath = data?.media?.path;
    if (!storagePath) return res.status(404).json({ error: 'no_media', message: 'Message has no media.path' });

    logMediaOp('GET /api/media/url', { inputJid: data?.metadata?.originJid, canonicalJid: data?.metadata?.originJid, accountId: null, convoId, msgId, storagePath, requestId });

    const url = await getSignedMediaUrl(storagePath, 3600000); // 1 hour
    if (!url) return res.status(500).json({ error: 'signed_url_failed' });

    res.json({ url, expiresIn: 3600, storagePath });
  } catch (e) {
    console.error('[SignedURL Error]', e);
    res.status(500).json({ error: e.message });
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
  logMediaOp('POST /messages/:jid/media', { inputJid: req.params.jid, canonicalJid, accountId: docId, convoId, msgId: null, storagePath: null, requestId });

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

    // Upload to Supabase Storage
    const mediaObj = await uploadMediaToStorage(buffer, convoId, messageId, mime, buffer.length, fileName);

    logMediaOp('POST /messages/:jid/media (write)', { inputJid: req.params.jid, canonicalJid, accountId: docId, convoId, msgId: messageId, storagePath: mediaObj?.path, requestId });

    // Sync to Supabase
    const preview = caption || (detectedType === 'image' ? '📷 Photo' : detectedType === 'video' ? '🎥 Video' : '📎 File');
    const syncOptions = { resolveCanonicalJid, messageId };
    if (mediaObj) syncOptions.media = mediaObj;
    await syncMessage(sent, jid, preview, null, docId, '', syncOptions);

    res.json({ status: 'sent', messageId, convoId, media: mediaObj || null });
  } catch (e) {
    console.error('[OutboundMedia Error]', e);
    res.status(500).json({ error: e.message });
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

// --- NEW: Send Message Route
app.post("/messages/:jid", async (req, res) => {
  let { jid } = req.params;
  let { text, accountId } = req.body; 

  // Normalize JID: WhatsApp Baileys requires pure numeric JIDs.
  // Stripping '+' prevents the duplicate thread bug where outgoing has '+' but incoming network replies don't.
  if (jid) {
      jid = jid.replace('+', '');
  }

  // ── Canonical JID: resolve before sending ──
  jid = resolveCanonicalJid(jid) || jid;

  console.log(`[Send-Debug] Request received for JID: ${jid} (canonical)`);
  console.log(`[Send-Debug] Body:`, JSON.stringify(req.body));

  // PARSE COMPOSITE ID (AccountId_ClientJid) for multi-tenancy
  // Unconditionally extract if it matches the known structural separator.
  if (!accountId && jid.includes('_')) {
      const parts = jid.split('_');
      accountId = parts[0];
      jid = parts.slice(1).join('_'); // The rest is the real JID
      console.log(`[Send-Debug] Extracted AccountId: ${accountId}, Real JID: ${jid}`);
  }

  if (!text) {
      console.log(`[Send-Debug] Error: Missing text`);
      return res.status(400).json({ error: "Missing text" });
  }

  // 1. Determine which session to use
  let sock = null;

  if (accountId) {
      // Explicit selection: MUST NOT FALLBACK to another session if this one is offline
      sock = sessionManager.getSession(accountId);
      
      if (!sock) {
         console.log(`[Send-Debug] Explicit account ${accountId} is offline or requires QR. Blocking cross-account fallback.`);
         return res.status(503).json({ error: "No active WhatsApp session found", accountId: accountId });
      } else {
         console.log(`[Send-Debug] Using explicit account session: ${accountId}`);
      }
  } else {
      // Auto-selection (fallback to first connected) - Only used for legacy endpoints
      for (const [docId, s] of sessionManager.sessions) {
          if (s.state === 'connected' && s.sock) {
              sock = s.sock;
              console.log(`[Send-Debug] Auto-selected session: ${docId}`);
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

    // Retry logic for groups — Baileys may throw 'forbidden' on groupMetadata
    // right after linking (group data not synced yet)
    let sent;
    const maxRetries = jid.endsWith('@g.us') ? 3 : 1;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        sent = await sock.sendMessage(jid, { text });
        console.log('[Send-Debug] sendMessage result:', JSON.stringify(sent));
        break; // success
      } catch (sendErr) {
        console.log(`[Send-Debug] sendMessage attempt ${attempt}/${maxRetries} failed:`, sendErr.message);
        if (sendErr.message === 'forbidden' && attempt < maxRetries) {
          console.log(`[Send-Debug] Group metadata not synced yet, retrying in 3s...`);
          await new Promise(r => setTimeout(r, 3000));
        } else {
          throw sendErr; // re-throw on last attempt or non-forbidden error
        }
      }
    }

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
      await syncMessage(sent, originJid, text, chatName, docId, label, { messageId, resolveCanonicalJid });
    } catch (syncErr) {
      console.error('Error syncing outbound message (non-fatal):', syncErr);
    }

    res.json({ status: 'ok', data: sent });
  } catch (e) {
    console.error('Error sending message:', e && (e.stack || e.toString()));
    res.status(500).json({ error: e.toString() });
  }
});

app.post("/admin/link-lid", requireAdminToken, (req, res) => {
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

app.get("/debug/contact/:id", requireAdminToken, (req, res) => {
  const c = getContact(req.params.id);
  res.json(c || { error: "Not found" });
});

app.get("/download-store", requireAdminToken, (req, res) => {
  if (fs.existsSync(STORE_FILE)) {
    res.download(STORE_FILE);
  } else {
    res.status(404).json({ error: "Store file not found" });
  }
});

app.get("/debug/name-resolution/:jid", requireAdminToken, (req, res) => {
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

/* ===== ACCOUNT MANAGEMENT API ===== */

// GET /api/wa-accounts - List accounts
app.get("/api/wa-accounts", (req, res) => {
  const accounts = [];
  sessionManager.sessions.forEach((val, key) => {
      accounts.push({
          id: key,
          label: val.label || key, // We might need to fetch label from DB if not in memory
          status: val.status,
          phoneNumber: val.sock?.user?.id?.split(':')[0] || ''
      });
  });
  res.json(accounts);
});


// POST /api/accounts/:id/regenerate-qr - Secured + rate limited
app.post("/api/accounts/:id/regenerate-qr", regenRateLimit, async (req, res) => {
  const docId = req.params.id;
  const force = req.query.force === 'true';
  const ip = req.ip || req.connection?.remoteAddress || '?';
  const ua = (req.headers['user-agent'] || '').substring(0, 60);
  console.log(`[HTTP] POST /regenerate-qr docId=${docId} force=${force} ip=${ip} ua=${ua}`);
  try {
    const result = await sessionManager.regenerateQR(docId, { force, ip, ua });
    const httpCode = result.status === 'cooldown' ? 429 : 200;
    res.status(httpCode).json({ ok: true, ...result });
  } catch (e) {
    console.error("[regenerate-qr] Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/regenerate-all - Bulk regenerate with concurrency control
app.post("/api/admin/regenerate-all", requireAdminToken, async (req, res) => {
  const concurrency = Math.min(parseInt(req.query.concurrency) || 2, 5);
  const results = [];
  const accounts = [];

  sessionManager.sessions.forEach((val, key) => {
    if (val.status === 'needs_qr' || val.status === 'disconnected') accounts.push(key);
  });

  try {
    const snap = await db.collection('wa_accounts').where('status', 'in', ['needs_qr', 'disconnected', 'logged_out']).get();
    snap.forEach(doc => { if (!accounts.includes(doc.id)) accounts.push(doc.id); });
  } catch (e) {
    console.error('[regenerate-all] DB error:', e.message);
  }

  console.log(`[Admin] regenerate-all: ${accounts.length} accounts, concurrency=${concurrency}`);

  for (let i = 0; i < accounts.length; i += concurrency) {
    const batch = accounts.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(async (docId) => {
        try {
          const result = await sessionManager.regenerateQR(docId, { ip: req.ip || '?', ua: 'admin-bulk' });
          return { docId, ...result };
        } catch (e) {
          return { docId, status: 'error', error: e.message };
        }
      })
    );
    for (const r of batchResults) {
      results.push(r.status === 'fulfilled' ? r.value : { docId: '?', status: 'error', error: r.reason?.message });
    }
    if (i + concurrency < accounts.length) {
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  res.json({
    ok: true,
    total: accounts.length,
    results,
    summary: {
      regenerating: results.filter(r => r.status === 'regenerating').length,
      already_regenerating: results.filter(r => r.status === 'already_regenerating').length,
      cooldown: results.filter(r => r.status === 'cooldown').length,
      error: results.filter(r => r.status === 'error').length,
    }
  });
});

/* ===== SECURE AUTH MIDDLEWARE & RESERVE ROUTES ===== */

// Supabase JWT token verification middleware (replaces legacy auth)
async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthenticated', message: 'Missing Bearer token' });
  }
  const token = authHeader.split('Bearer ')[1];
  try {
    // Verify Supabase JWT by calling Supabase auth API
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      throw new Error(error?.message || 'Invalid token');
    }
    req.user = { uid: user.id, email: user.email, ...user.user_metadata };
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
app.post(/^\/api\/conversations\/(.+)\/reserve$/, verifyToken, async (req, res) => {
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
          reservedAt: new Date().toISOString(),
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
        reservedAt: new Date().toISOString(),
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
 * Uses Supabase directly (no subcollections needed).
 */
app.post('/api/user/consent', async (req, res) => {
  try {
    // Extract user ID from body or auth header (flexible — no strict JWT verification)
    const uid = req.body.userId || req.body.uid || 'anonymous';
    const { consentVersion, userAgent } = req.body;
    
    // Upsert consent into Supabase — creates user_consents if needed
    const { error: insertErr } = await supabase.from('user_consents').insert({
      user_id: uid,
      consent_version: consentVersion || 'v1',
      user_agent: userAgent || req.headers['user-agent'] || 'unknown',
      ip_address: req.ip,
      consent_type: 'employee_recording_agreement',
      created_at: new Date().toISOString()
    });

    // If table doesn't exist, fall back to simple OK response (consent recorded in logs)
    if (insertErr) {
      console.warn('[Consent] DB insert failed (table may not exist):', insertErr.message);
      console.log(`[Consent] RECORDED — uid=${uid} version=${consentVersion || 'v1'} type=employee_recording_agreement`);
    }

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
app.post('/api/user/deletion-request', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { reason } = req.body;

    const ticketId = `del_${uid}_${Date.now()}`;
    const { error: insertErr } = await supabase.from('deletion_requests').insert({
      id: ticketId,
      user_id: uid,
      email: req.user.email || 'unknown',
      reason: reason || 'user_request',
      status: 'pending',
      requested_at: new Date().toISOString()
    });

    if (insertErr) {
      console.warn('[Deletion] DB insert failed:', insertErr.message);
      console.log(`[Deletion] RECORDED — uid=${uid} reason=${reason || 'user_request'}`);
    }

    res.json({ status: 'received', ticketId });
  } catch (e) {
    console.error("Error creating deletion request:", e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/user/privacy-settings
 * Updates user privacy preferences (e.g. AI analysis).
 */
app.post('/api/user/privacy-settings', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { aiAnalysisEnabled } = req.body;

    if (aiAnalysisEnabled === undefined) {
      return res.status(400).json({ error: "Missing aiAnalysisEnabled" });
    }

    const { error: upsertErr } = await supabase.from('user_settings').upsert({
      user_id: uid,
      ai_analysis_enabled: !!aiAnalysisEnabled,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

    if (upsertErr) {
      console.warn('[Privacy] DB upsert failed:', upsertErr.message);
      console.log(`[Privacy] RECORDED — uid=${uid} aiAnalysisEnabled=${!!aiAnalysisEnabled}`);
    }

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
app.get('/api/user/me', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    
    // Fetch latest consent
    const { data: consents } = await supabase
      .from('user_consents')
      .select('consent_version, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(1);
    
    // Fetch settings
    const { data: settings } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', uid)
      .limit(1);

    res.json({
      exists: true,
      uid,
      latestConsentVersion: consents?.[0]?.consent_version || null,
      consentGivenAt: consents?.[0]?.created_at || null,
      privacySettings: settings?.[0] || null
    });
  } catch (e) {
    console.error("Error fetching user profile:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ===== END COMPLIANCE APIS ===== */

/* ========== Prometheus /metrics endpoint ========== */
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', metricsRegistry.contentType);
    res.end(await metricsRegistry.metrics());
  } catch (e) {
    res.status(500).end(e.message);
  }
});

/* Start server & WhatsApp connect (minimal) */
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';
const server = app.listen(PORT, BIND_HOST, () => {
  logger.info(`SERVER STARTUP complete on ${BIND_HOST}:${PORT}`);
  console.log(`[Express] Server bound to ${BIND_HOST}:${PORT}`);
});

// ── Attach WebSocket upgrade listener ──
server.on('upgrade', (request, socket, head) => {
  // Use a dummy host to parse the local path robustly
  const { pathname, searchParams } = new URL(request.url, `http://localhost`);
  
  if (pathname === '/voip-ws' || pathname === '/api/voip-ws') {
    const token = searchParams.get('token');
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    
    try {
      const decoded = jwt.verify(token, process.env.WS_JWT_SECRET || 'superparty_ws_secret_123');
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, decoded);
      });
    } catch (err) {
      console.error('[WS Upgrade] JWT validation failed:', err.message);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  } else {
    // Only destroying if it's explicitly for us, or maybe allow other upgrade paths if we use socket.io?
    // Since we also use socket.io, it attaches its own upgrade handler.
    // If we destroy everything else, we might break standard Socket.IO.
    // So if it's NOT /voip-ws, do NOTHING here (let Socket.IO or others handle it, though they usually hook on their own paths).
  }
});

/* Signal handling for safe shutdown */
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
