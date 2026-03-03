import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  downloadMediaMessage
} from "@whiskeysockets/baileys";
import crypto from "node:crypto";
import pino from "pino";
import fs from "fs";
import path from "path";
import { supabase, syncMessage, syncConversationActivity, uploadMediaToStorage } from "./supabase-sync.mjs";
import googleSync from "./google-sync.js";
import { classifyClose, getBackoffDelay, Classification } from "./session-classifier.js";

// ─── Constants ──────────────────────────────────────────────────────
const MAX_RECONNECT_ATTEMPTS   = 5;
const MAX_UNKNOWN_ATTEMPTS     = 3;   // Lower cap for UNKNOWN classification
const CONNECTION_TIMEOUT_MS    = 30_000;

// Helper to sanitize docId for filesystem safety
function safeDocId(docId) {
  return docId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class SessionManager {
  constructor(store) {
    this.store = store;
    this.sessions = new Map();            // docId -> { sock, qr, status, reconnectAttempts, reconnectTimer, label, pairingPhase, ... }
    this._regeneratingState = new Map();   // docId -> { startedAt, phase: 'regenerating'|'qr_ready'|'pairing'|'connected' }
    this._closeSuppressed = new Set();     // DocIds where close events should be ignored (during intentional stop)
    this.metrics = {
      close_total: {},                    // { "TERMINAL_LOGOUT:401": N, "TRANSIENT:408": N, ... }
      needs_qr_total: 0,
      reconnect_attempt_total: 0,
      reconnect_exhausted_total: 0,
      qr_regenerate_total: 0,
      successful_reconnect_total: 0,
    };
  }

  // ─── Metrics helper ─────────────────────────────────────────────
  _incMetric(classification, code) {
    const key = `${classification}:${code ?? "null"}`;
    this.metrics.close_total[key] = (this.metrics.close_total[key] || 0) + 1;
  }

  // ─── Telemetry Helper for Mobile Dashboard ──────────────────────
  async _pushTelemetry(docId, eventData) {
    if (!supabase) return;
    try {
      // Build safe update object
      const updatePayload = {
        updated_at: new Date().toISOString()
      };

      if (eventData.state) updatePayload.status = eventData.state;
      if (eventData.pingMs !== undefined) updatePayload.pingms = eventData.pingMs;
      
      const { data: existingDoc } = await supabase.from('wa_accounts').select('recent_logs').eq('id', docId).single();
      let logs = Array.isArray(existingDoc?.recent_logs) ? existingDoc.recent_logs : [];

      // Atomically push strictly technical event strings for logs array (cap at 10 on client or via rotation)
      if (eventData.logString) {
          const timestamp = new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const logEntry = `[${timestamp}] ${eventData.logString}`;
          logs.push(logEntry);
          if (logs.length > 20) logs = logs.slice(-20);
          updatePayload.recent_logs = logs;
      }

      await supabase.from('wa_accounts').update(updatePayload).eq('id', docId);
    } catch (e) {
      console.error(`[Telemetry] Failed to push telemetry for ${docId}:`, e.message);
    }
  }

  // ─── Initialize: Scan Supabase for existing accounts ───────────
  async init() {
    console.log("[SessionManager] Initializing...");
    if (!supabase) {
       console.error("[SessionManager] Supabase DB not ready!");
       return;
    }

    // Load initial accounts
    const { data: accounts, error } = await supabase.from('wa_accounts').select('*');
    if (!error && accounts) {
        for (const acc of accounts) {
            console.log(`[SessionManager] Loading existing account: ${acc.id}`);
            this.startSession(acc.id, acc.label);
        }
    }

    // Listen for account changes via Supabase Realtime
    supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wa_accounts' },
        (payload) => {
          const docId = payload.new?.id || payload.old?.id;
          if (!docId) return;

          if (payload.eventType === 'INSERT') {
            console.log(`[SessionManager] New account detected: ${docId}`);
            this.startSession(docId, payload.new.label);
          } else if (payload.eventType === 'UPDATE') {
             const s = this.sessions.get(docId);
             if (s && payload.new.label) s.label = payload.new.label;
          } else if (payload.eventType === 'DELETE') {
            console.log(`[SessionManager] Account removed: ${docId}`);
            this.stopSession(docId);
          }
        }
      )
      .subscribe((status, err) => {
          if (err) console.error("[SessionManager] Supabase Listen Error:", err);
      });
      
    this.startHeartbeat();
  }

  // ─── Global Heartbeat ───────────────────────────────────────────
  startHeartbeat() {
    setInterval(async () => {
      const nowMs = Date.now();
      for (const [docId, s] of this.sessions.entries()) {
        if (s.status === 'connected') {
          try {
            const pingMs = s.sock?.ws?.ping || 0;
            await supabase.from('wa_accounts').update({ 
                last_ping_at: nowMs, 
                ping_ms: pingMs,
                last_seen_at: nowMs 
            }).eq('id', docId);
          } catch(e) {
            console.error(`[Heartbeat] Failed for ${docId}:`, e.message);
          }
        }
      }
    }, 30000); // 30 sec delay
  }

  // ─── Start Session (with boot guard) ────────────────────────────
  async startSession(docId, label = '') {
    const existing = this.sessions.get(docId);
    if (existing && existing.sock) {
      console.log(`[SessionManager] Session ${docId} already active with live socket.`);
      return;
    }
    // Remove placeholder/dead session so we can replace it
    if (existing) {
      console.log(`[SessionManager] ${docId} replacing ${existing.status} placeholder`);
      if (existing.reconnectTimer) clearTimeout(existing.reconnectTimer);
      this.sessions.delete(docId);
    }

    // Clear any stale close-suppression flag from a previous stopSession
    // This prevents the old socket's delayed close event from killing the new session
    this._closeSuppressed.delete(docId);

    // ── Boot Guard: Check if session requires QR scan ──
    try {
      const { data, error } = await supabase.from('wa_accounts').select('status, requires_qr').eq('id', docId).single();
      if (!error && data) {
        if (data.requires_qr === true || data.status === "needs_qr" || data.status === "logged_out") {
          console.log(`[SessionManager] BOOT_GUARD ${docId} requires QR scan (status=${data.status}, requires_qr=${data.requires_qr}) — skipping auto-reconnect`);
          // Track it in sessions map so /status shows it
          this.sessions.set(docId, { 
            sock: null, qr: null, status: 'needs_qr', 
            reconnectAttempts: 0, reconnectTimer: null, label 
          });
          return;
        }
      }
    } catch (e) {
      console.error(`[SessionManager] Boot guard check failed for ${docId}:`, e.message);
      // Continue connecting if we can't check — fail open for transient issues
    }

    const safe = safeDocId(docId);
    const authPath = path.join(process.cwd(), "auth_info", safe);

    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
      browser: ["SuperParty", "Chrome", "22.0"],
      logger: pino({ level: "silent" }),
      connectTimeoutMs: CONNECTION_TIMEOUT_MS,
      keepAliveIntervalMs: 15000,
      emitOwnEvents: true,
      shouldIgnoreJid: jid => isJidBroadcast(jid),
    });

    // Track session
    const sessionData = { 
      sock, qr: null, status: 'connecting', 
      reconnectAttempts: 0, reconnectTimer: null, 
      restartCount: 0, label,
      qrSeq: 0, qrUpdatedAt: null,    // QR rotation tracking
      reqId: null,                      // Active regeneration request ID
    };
    this.sessions.set(docId, sessionData);
    
    // Telemetry: Boot initiated
    this._pushTelemetry(docId, { state: 'connecting', logString: '🔄 Initiating Baileys socket boot...' });

    // Bind to Global Store
    this.store.bind(sock.ev);

    // Ev: Creds Update — log, persist, and update pairing phase
    sock.ev.on("creds.update", async () => {
      const rstate = this._regeneratingState.get(docId);
      const phase = rstate?.phase;
      console.log(`[SessionManager] ${docId} CREDS_UPDATE fired (phase=${phase || 'none'}) — saving to disk`);
      // Promote phase to 'pairing' after first creds.update in QR flow
      if (rstate && (rstate.phase === 'qr_ready' || rstate.phase === 'regenerating')) {
        rstate.phase = 'pairing';
        console.log(`[SessionManager] ${docId} phase → pairing (post-scan window protected)`);
      }
      try {
        await saveCreds();
        console.log(`[SessionManager] ${docId} CREDS_UPDATE — save complete`);
      } catch (e) {
        console.error(`[SessionManager] ${docId} CREDS_UPDATE — save FAILED:`, e.message);
      }
    });

    // Write initial creds to disk immediately (don't wait for event)
    try {
      await saveCreds();
      console.log(`[SessionManager] ${docId} initial creds written to disk`);
    } catch (e) {
      console.error(`[SessionManager] ${docId} initial creds write FAILED:`, e.message);
    }

    // Ev: Connection Update
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        sessionData.qrSeq = (sessionData.qrSeq || 0) + 1;
        sessionData.qrUpdatedAt = new Date();
        const qrHash = qr.substring(0, 8);
        console.log(`[SessionManager] ${docId} QR_UPDATE seq=${sessionData.qrSeq} hash=${qrHash}`);
        sessionData.qr = qr;
        sessionData.status = 'needs_qr';
        // Update pairing phase
        const rstate = this._regeneratingState.get(docId);
        if (rstate) rstate.phase = 'qr_ready';
        // Write QR data to Supabase so Flutter app can display it via QrImageView
        await supabase.from('wa_accounts').update({ 
            status: 'needs_qr', 
            qr_code: qr, 
            qr_available: true, 
            qr_seq: sessionData.qrSeq, 
            needs_qr_since: Date.now(),
            updated_at: Date.now() 
        }).eq('id', docId);
        
        this._pushTelemetry(docId, { state: 'disconnected', logString: '⚠️ QR Code required for authentication.' });
      }

      if (connection === "close") {
        await this._handleClose(docId, lastDisconnect, label);
      } else if (connection === "open") {
        console.log(`[SessionManager] ${docId} CONNECTED`);
        sessionData.status = 'connected';
        sessionData.qr = null;
        sessionData.reconnectAttempts = 0;
        this.metrics.successful_reconnect_total++;
        
        // Resolve regeneration — release strong mutex
        const rstate = this._regeneratingState.get(docId);
        if (rstate) {
          rstate.phase = 'connected';
          console.log(`[SessionManager] ${docId} regeneration COMPLETE — releasing lock`);
          this._regeneratingState.delete(docId);
        }

        const userJid = sock.user?.id?.split(':')[0] || "unknown";
        await supabase.from('wa_accounts').update({ 
            status: 'connected', 
            qr_code: null, 
            requires_qr: false,
            needs_qr_since: null,
            connected_at: Date.now(),
            last_seen_at: Date.now(),
            phone_number: userJid, 
            updated_at: Date.now() 
        }).eq('id', docId);
        
        this._pushTelemetry(docId, { state: 'connected', logString: `✅ Connected successfully (${userJid})` });
      }
    });

    // Ev: Messages Upsert
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        // Telemetry: Message Counter Bump (Fast Fire-and-Forget)
        // Note: For OUT messages sent via the Superparty App, the manual POST /messages API already increments `messagesOut`.
        // To prevent double-counting (+2 instead of +1), we ONLY increment `messagesIn` here natively, OR we check if we want
        // to count native device outbound messages (from the master phone). For now, we only count IN here to prevent the flutter app bug.
        const inb = messages.filter(m => !m.key.fromMe).length;
        const outb = messages.filter(m => m.key.fromMe).length;
        
        // We only append OUT if it's strictly a 'notify' event (meaning the user typed on the physically linked Master Phone, not the API).
        // API messages usually trigger an 'append' event, which we ignore telemetry for here.
        let outbToTrack = 0;
        if (type === 'notify') {
             outbToTrack = outb;
        }
        
        console.log(`[TELEM DEBUG] Upsert docId: ${docId}, type: ${type}, IN: ${inb}, native OUT: ${outbToTrack}`);
        
        if ((inb > 0 || outbToTrack > 0) && supabase) {
           try {
             // Supabase handles incrementing slightly differently via RPC, or we track stats in client apps.
             // We omit direct FieldValue logic for simplicity to preserve performance in ESM.
           } catch(e) {
             console.error("Telemetry fallback error", e);
           }
        }

        // We removed `if (type !== 'notify') return;` here because we MUST process 'append' 
        // messages so they get written to Supabase and show up in the Flutter App.
        
        for (const msg of messages) {
            try {
                if (!msg.message) continue;
                this.handleMessage(docId, msg, this._resolveCanonicalJid);
            } catch (e) {
                console.error(`[SessionManager] Msg Error ${docId}:`, e);
            }
        }
    });
  }

  // ─── Handle Connection Close ────────────────────────────────────
  async _handleClose(docId, lastDisconnect, label) {
    // Skip if this close was triggered by an intentional stopSession (e.g., during regenerateQR)
    if (this._closeSuppressed.has(docId)) {
      console.log(`[SessionManager] CLOSE docId=${docId} SUPPRESSED (intentional stop)`);
      this._closeSuppressed.delete(docId);
      return;
    }

    const { classification, code, reason } = classifyClose(lastDisconnect);
    const sessionData = this.sessions.get(docId);
    const attempts = sessionData?.reconnectAttempts ?? 0;

    // Structured log
    console.log(`[SessionManager] CLOSE docId=${docId} code=${code} reason=${reason} classification=${classification} attempts=${attempts}`);
    this._pushTelemetry(docId, { state: 'disconnected', logString: `❌ Disconnected (Code: ${code}, Reason: ${reason})` });
    
    // Metrics
    this._incMetric(classification, code);

    // ── TERMINAL_LOGOUT ──
    if (classification === Classification.TERMINAL_LOGOUT) {
      console.log(`[SessionManager] ${docId} TERMINAL_LOGOUT — clearing auth and requiring QR`);
      
      // 1. Clear any pending reconnect timer
      if (sessionData?.reconnectTimer) {
        clearTimeout(sessionData.reconnectTimer);
        sessionData.reconnectTimer = null;
      }

      // 2. Stop the socket
      this.stopSession(docId);

      // 3. Back up then delete auth_info
      const safe = safeDocId(docId);
      const authPath = path.join(process.cwd(), "auth_info", safe);
      const backupPath = path.join(process.cwd(), "auth_info_backup", `${safe}_${Date.now()}`);
      try {
        if (fs.existsSync(authPath)) {
          await fs.promises.mkdir(path.dirname(backupPath), { recursive: true });
          await fs.promises.cp(authPath, backupPath, { recursive: true });
          await fs.promises.rm(authPath, { recursive: true, force: true });
          console.log(`[SessionManager] ${docId} auth_info backed up and deleted`);
        }
      } catch (e) {
        console.error(`[SessionManager] ${docId} auth cleanup failed:`, e.message);
      }

      // 4. Update Supabase
      await supabase.from('wa_accounts').update({ 
        status: 'needs_qr', 
        requires_qr: true,
        qr_code: null, 
        last_close_reason: reason,
        last_close_code: code?.toString() || '',
        reconnect_attempts: 0,
        connected_at: null,
        needs_qr_since: Date.now(),
        updated_at: Date.now() 
      }).eq('id', docId);

      // 5. Keep a placeholder in sessions map so /status shows this account
      this.sessions.set(docId, { 
        sock: null, qr: null, status: 'needs_qr', 
        reconnectAttempts: 0, reconnectTimer: null, label 
      });

      this.metrics.needs_qr_total++;
      return;
    }

    // ── QR_EXPIRED (QR window timed out without scan) ──
    if (classification === Classification.QR_EXPIRED) {
      console.log(`[SessionManager] ${docId} QR_EXPIRED — QR window timed out. Waiting for manual regenerate.`);
      
      // Stop the socket but keep auth_info (no auth invalidation happened)
      this.stopSession(docId);

      // Update Supabase — mark as needs_qr so the app shows "Regenerate QR" button
      await supabase.from('wa_accounts').update({ 
        status: 'needs_qr', 
        requires_qr: true,
        qr_code: null, 
        last_close_reason: reason,
        last_close_code: code?.toString() || '',
        reconnect_attempts: 0,
        connected_at: null,
        needs_qr_since: Date.now(),
        updated_at: Date.now() 
      }).eq('id', docId);

      // Keep placeholder in sessions map
      this.sessions.set(docId, { 
        sock: null, qr: null, status: 'needs_qr', 
        reconnectAttempts: 0, reconnectTimer: null, label 
      });

      this.metrics.needs_qr_total++;
      return;
    }

    // ── TRANSIENT or UNKNOWN ──
    const maxAttempts = classification === Classification.UNKNOWN ? MAX_UNKNOWN_ATTEMPTS : MAX_RECONNECT_ATTEMPTS;
    const nextAttempt = attempts + 1;

    if (nextAttempt > maxAttempts) {
      // Exhausted retries
      console.log(`[SessionManager] ${docId} reconnect EXHAUSTED after ${attempts} attempts`);
      
      if (sessionData) {
        sessionData.status = 'disconnected';
        sessionData.reconnectAttempts = nextAttempt;
      }
      
      await supabase.from('wa_accounts').update({ 
        status: 'disconnected', 
        qr_code: null, 
        reconnect_attempts: nextAttempt,
        last_close_reason: reason,
        last_close_code: code?.toString() || '',
        connected_at: null,
        updated_at: Date.now() 
      }).eq('id', docId);

      this.metrics.reconnect_exhausted_total++;
      // Leave auth_info intact — operator can manually trigger regenerateQR if needed
      return;
    }

    // Schedule reconnect with backoff
    const delay = getBackoffDelay(attempts);
    console.log(`[SessionManager] ${docId} TRANSIENT — reconnecting in ${delay}ms (attempt ${nextAttempt}/${maxAttempts})`);
    
    // Clean up old session from map
    this.sessions.delete(docId);
    
    await supabase.from('wa_accounts').update({ 
      status: 'reconnecting', 
      qr_code: null, 
      reconnect_attempts: nextAttempt,
      last_close_reason: reason,
      last_close_code: code?.toString() || '',
      connected_at: null,
      updated_at: Date.now() 
    }).eq('id', docId);

    this.metrics.reconnect_attempt_total++;

    // Schedule with single timer (prevent duplicates)
    const timer = setTimeout(async () => {
      console.log(`[SessionManager] ${docId} executing reconnect attempt ${nextAttempt}`);
      // Temporarily set attempts on a marker so startSession picks it up
      await this.startSession(docId, label);
      const newSession = this.sessions.get(docId);
      if (newSession) {
        newSession.reconnectAttempts = nextAttempt;
      }
    }, delay);

    // Store reference to prevent duplicates
    // We can't store on sessionData (deleted), so we create a placeholder
    this.sessions.set(docId, {
      sock: null, qr: null, status: 'reconnecting',
      reconnectAttempts: nextAttempt, reconnectTimer: timer, label
    });
  }

  // ─── Stop Session ───────────────────────────────────────────────
  async stopSession(docId, reason = 'unknown') {
    const session = this.sessions.get(docId);
    if (session) {
      console.log(`[SessionManager] STOP_SESSION docId=${docId} reason=${reason}`);
      if (session.reconnectTimer) {
        clearTimeout(session.reconnectTimer);
        session.reconnectTimer = null;
      }
      try {
        if (session.sock) {
          // Mark as suppressed BEFORE calling end(), so the close event handler ignores it
          this._closeSuppressed.add(docId);
          session.sock.end();
        }
      } catch (e) {}
      this.sessions.delete(docId);
    }
  }

  // ─── Regenerate QR (Manual) — Strong Mutex ─────────────────────
  async regenerateQR(docId, { force = false, reqId = null, ip = '', ua = '' } = {}) {
    const COOLDOWN_MS = 10_000;   // 10s cooldown between regenerations
    const PAIRING_TIMEOUT_MS = 120_000; // 120s max pairing window
    reqId = reqId || crypto.randomUUID().slice(0, 8);

    // Strong mutex: check if regeneration is already in progress
    const existing = this._regeneratingState.get(docId);
    if (existing) {
      const elapsed = Date.now() - existing.startedAt;

      // Cooldown: reject if started less than 10s ago (even if phase changed)
      if (elapsed < COOLDOWN_MS && !force) {
        console.log(`[SessionManager] REGEN_REJECT reqId=${reqId} docId=${docId} reason=cooldown phase=${existing.phase} elapsed=${Math.round(elapsed/1000)}s ip=${ip} ua=${ua}`);
        return { status: 'cooldown', phase: existing.phase, elapsedMs: elapsed, retryAfterMs: COOLDOWN_MS - elapsed };
      }

      // Reject during active pairing/connected unless force=true
      if ((existing.phase === 'pairing' || existing.phase === 'connected') && !force) {
        console.log(`[SessionManager] REGEN_REJECT reqId=${reqId} docId=${docId} reason=protected_phase phase=${existing.phase} elapsed=${Math.round(elapsed/1000)}s ip=${ip} ua=${ua}`);
        return { status: 'already_regenerating', phase: existing.phase, elapsedMs: elapsed, protected: true };
      }

      // Within pairing timeout window and not forced
      if (elapsed < PAIRING_TIMEOUT_MS && !force) {
        console.log(`[SessionManager] REGEN_REJECT reqId=${reqId} docId=${docId} reason=in_progress phase=${existing.phase} elapsed=${Math.round(elapsed/1000)}s ip=${ip} ua=${ua}`);
        return { status: 'already_regenerating', phase: existing.phase, elapsedMs: elapsed };
      }

      // Timeout expired — allow new regeneration
      console.log(`[SessionManager] ${docId} regenerateQR — previous timed out after ${Math.round(elapsed/1000)}s, allowing new`);
      this._regeneratingState.delete(docId);
    }

    // Set strong mutex with timestamp and reqId
    this._regeneratingState.set(docId, { startedAt: Date.now(), phase: 'regenerating', reqId });
    console.log(`[SessionManager] REGEN_START reqId=${reqId} docId=${docId} ip=${ip} ua=${ua}`);

    try {
      // 1. Stop existing session
      await this.stopSession(docId, `regenerate:${reqId}`);

      // 2. Delete auth_info
      const safe = safeDocId(docId);
      const authPath = path.join(process.cwd(), "auth_info", safe);
      try {
        if (fs.existsSync(authPath)) {
          await fs.promises.rm(authPath, { recursive: true, force: true });
        }
      } catch (e) {
        console.error(`[SessionManager] ${docId} auth cleanup in regenerate failed:`, e.message);
      }

      // 3. Reset Supabase state
      await supabase.from('wa_accounts').update({ 
        status: 'connecting', 
        requires_qr: false,
        qr_code: null,
        qr_available: false,
        reconnect_attempts: 0,
        updated_at: Date.now() 
      }).eq('id', docId);

      // 4. Fetch label from Supabase
      const { data: doc } = await supabase.from('wa_accounts').select('label').eq('id', docId).single();
      const label = doc ? (doc.label || '') : '';

      // 5. Start fresh session (will generate new QR)
      await this.startSession(docId, label);

      // Tag session with reqId
      const sess = this.sessions.get(docId);
      if (sess) sess.reqId = reqId;

      // 6. Schedule timeout to release lock if connection never opens
      setTimeout(() => {
        const state = this._regeneratingState.get(docId);
        if (state && state.phase !== 'connected') {
          console.log(`[SessionManager] REGEN_TIMEOUT reqId=${state.reqId} docId=${docId} phase=${state.phase} elapsed=${PAIRING_TIMEOUT_MS/1000}s`);
          this._regeneratingState.delete(docId);
        }
      }, PAIRING_TIMEOUT_MS);

      this.metrics.qr_regenerate_total++;
      return { status: 'regenerating', reqId };
    } catch (e) {
      console.error(`[SessionManager] REGEN_FAILED reqId=${reqId} docId=${docId} error=${e.message}`);
      this._regeneratingState.delete(docId);
      throw e;
    }
  }

  // --- Message Handling (Ported from index.js) ---
  async handleMessage(docId, msg, resolveCanonicalJid = null) {
      // 1. Sync to Supabase
      const originJid = msg.key.remoteJid;
      const isGroup = originJid.endsWith('@g.us');
      
      // Default: For private chats, try to find Contact Name first, then pushName.
      // For groups, START with null (don't overwrite).
      let chatName = null;

      if (isGroup) {
          chatName = null; 
      } else {
          // Try to get contact name from store (The name saved in phone)
          const contact = this.store?.contacts?.[originJid];
          if (contact && (contact.name || contact.notify)) {
              chatName = contact.name || contact.notify; 
          } else {
              chatName = msg.pushName || originJid.split('@')[0];
          }
      }
      
      // Attempt to get better name for groups
      if (isGroup) {
          try {
              const session = this.sessions.get(docId);
              if (session && session.sock) {
                  // Check store or fetch
                  const groupMetadata = await session.sock.groupMetadata(originJid);
                  if (groupMetadata && groupMetadata.subject) {
                      chatName = groupMetadata.subject;
                  }
              }
          } catch (e) {
              console.log(`[SessionManager] Failed to fetch group name for ${originJid}`, e.message);
              // Do NOT fallback to pushName here. Leave as null to preserve existing DB name.
          }
      }

      const preview = this.getMessagePreview(msg);
      const session = this.sessions.get(docId);
      const label = session ? session.label : '';
      
      let mediaInfo = null;

      try {
        mediaInfo = await this.downloadAndSaveMedia(msg, docId, resolveCanonicalJid);
      } catch (e) {
        console.error(`[SessionManager] Media download failed for ${msg.key.id}:`, e);
      }

      try {
        // Attempt to fetch profile picture in real-time
        let photoUrl = null;
        try {
            const session = this.sessions.get(docId);
            if (session && session.sock) {
                photoUrl = await session.sock.profilePictureUrl(originJid, 'image').catch(() => null);
            }
        } catch (photoErr) {
            console.log(`[SessionManager] Soft fail fetching photo for ${originJid}`);
        }

        // Construiesc obiectul pentru Supabase
        const ts = (msg.messageTimestamp?.low || msg.messageTimestamp) || Math.floor(Date.now()/1000);
        const fromMe = msg.key.fromMe;
        const canonicalJid = resolveCanonicalJid ? (resolveCanonicalJid(originJid) || originJid) : originJid;
        
        const msgData = {
            id: msg.key.id,
            conversation_id: `${docId}_${canonicalJid}`,
            wa_account_id: docId,
            direction: fromMe ? 'outbound' : 'inbound',
            content: preview,
            timestamp: new Date(ts * 1000).toISOString(),
            status: fromMe ? 'sent' : 'delivered',
            external_data: { pushName: msg.pushName },
            media_url: syncOptions.media?.path || syncOptions.mediaUrl || null,
            media_type: syncOptions.media?.mimetype || syncOptions.mimetype || null
        };
        
        await syncMessage(msgData);
      } catch (e) { console.error("Supabase sync error", e); }

      // 2. Google Sync
      try {
          const ts = (msg.messageTimestamp?.low || msg.messageTimestamp) || Math.floor(Date.now()/1000);
          const fromMe = msg.key.fromMe;
          
          // Construct Chat Object for Google
          const chatForGoogle = {
              chat_id: originJid,
              is_group: originJid.endsWith('@g.us'),
              phone: originJid.replace('@s.whatsapp.net', '').replace('@g.us', ''),
              name: chatName, // Use resolved name
              last_message_text: preview,
              last_message_type: Object.keys(msg.message || {})[0] || 'text',
              last_sender_name: msg.pushName || (fromMe ? 'Me' : ''),
              last_message_ts: ts,
              unread_count: 0, 
              last_message_id: msg.key.id
          };
          googleSync.upsertChatInGoogle(chatForGoogle);

          // Construct Msg Row
          const msgRow = [
             new Date(ts * 1000).toISOString(),
             msg.key.id,
             originJid,
             fromMe ? 1 : 0,
             msg.pushName || '',
             preview,
             Object.keys(msg.message || {})[0] || 'unknown',
             mediaUrl || "" // media link
          ];
          googleSync.appendMessageRow(msgRow);

      } catch (e) { console.error("Google Sync error", e); }
  }

  async downloadAndSaveMedia(msg, accountId = null, resolveCanonicalJid = null) {
    if (!msg.message) return null;
    
    // Check key types (including ephemeral/viewOnce unwrap)
    let msgContent = msg.message;
    if (msgContent.ephemeralMessage) msgContent = msgContent.ephemeralMessage.message || msgContent;
    if (msgContent.viewOnceMessage) msgContent = msgContent.viewOnceMessage.message || msgContent;
    if (msgContent.viewOnceMessageV2) msgContent = msgContent.viewOnceMessageV2.message || msgContent;
    
    const type = Object.keys(msgContent).find(k => 
        k === 'imageMessage' || 
        k === 'videoMessage' || 
        k === 'audioMessage' || 
        k === 'stickerMessage' || 
        k === 'documentMessage'
    );
    
    if (!type) return null;
    
    const content = msgContent[type];
    const mimetype = content.mimetype || null;
    const fileName = content.fileName || content.title || null;
    
    try {
        const buffer = await downloadMediaMessage(
            msg,
            'buffer',
            { },
            { 
                logger: pino({ level: 'silent' }),
                reuploadRequest: (msg.key.fromMe) 
            }
        );
        
        if (!buffer) return null;

        // 1. Try Supabase Storage upload
        if (accountId) {
          const originJid = msg.key.remoteJid;
          const canonicalJid = resolveCanonicalJid ? (resolveCanonicalJid(originJid) || originJid) : originJid;
          const convoId = `${accountId}_${canonicalJid}`;
          const msgId = msg.key.id;
          
          const mediaObj = await uploadMediaToStorage(buffer, convoId, msgId, mimetype, buffer.length, fileName);
          if (mediaObj) {
            console.log(`[Media] Uploaded to Storage: ${mediaObj.path} (${mediaObj.size} bytes)`);
            
            // Also save locally as fallback
            try {
              const ext = (mimetype || '').split('/')[1]?.split(';')[0] || 'bin';
              const filename = `${msg.key.id}.${ext}`;
              const filePath = path.join(process.cwd(), 'public', 'media', filename);
              await fs.promises.writeFile(filePath, buffer);
            } catch (localErr) {
              // Non-fatal: local save is just fallback
            }
            
            return mediaObj;
          }
        }
        
        // 2. Fallback: save to local disk only
        const ext = (mimetype || '').split('/')[1]?.split(';')[0] || 'bin';
        const filename = `${msg.key.id}.${ext}`;
        const filePath = path.join(process.cwd(), 'public', 'media', filename);
        
        await fs.promises.writeFile(filePath, buffer);
        
        return {
            url: `/media/${filename}`,
            mimetype: mimetype
        };
    } catch (e) {
        console.error("Error downloading media:", e);
        return null;
    }
  }

  getMessagePreview(msg) {
      if(!msg.message) return '';
      return msg.message.conversation || 
             msg.message.extendedTextMessage?.text || 
             msg.message.imageMessage?.caption || 
             (msg.message.imageMessage ? '📷 Photo' : null) ||
             (msg.message.videoMessage ? '🎥 Video' : null) ||
             'Media Message';
  }

  getSession(docId) {
      return this.sessions.get(docId)?.sock;
  }
}
