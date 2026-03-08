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




// ─── FCM FALLBACK: LEGACY ENDPOINTS RESTORED ──────────────────────────────
// Enhanced /api/voice/accept with robust logging, validation, and distributed Redlock

/* ========== Health + Metrics ========== */

// GET /health — unauthenticated, for uptime monitors and smoke tests
app.get('/health', (req, res) => {
  const sessionCount = sessionManager?.sessions?.size ?? 0;
  res.json({
    status: 'ok',
    service: 'superparty-backend',
    uptime: Math.round(process.uptime()),
    sessions: sessionCount,
    ts: new Date().toISOString(),
  });
});

// GET /metrics — Prometheus scrape, admin-token protected
app.get('/metrics', requireAdminToken, async (req, res) => {
  try {
    const metrics = await metricsRegistry.metrics();
    res.setHeader('Content-Type', metricsRegistry.contentType);
    res.send(metrics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ========== Server Boot ========== */
const httpServer = app.listen(PORT, () => {
  logger.info({ port: PORT }, `[superparty-backend] Listening on port ${PORT}`);
});

// Upgrade HTTP → WebSocket
httpServer.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request, {});
  });
});
