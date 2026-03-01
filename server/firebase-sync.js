import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getAuth } from "firebase-admin/auth";
import fs from "fs";
import path from "path";

// Importam noul modul de Supabase
import { syncMessageToSupabase, syncConversationActivity } from "./supabase-sync.js";

// Prefer env var, fallback to local file
const SERVICE_ACCOUNT_PATH = "./firebase-service-account.json";

// export so other modules can import the live reference
export { getAuth };
export let db = null;
export let storageBucket = null;

// Anti-amestec callback — set by main index to increment Prometheus counter
let _onCanonicalMismatch = null;
export function setCanonicalMismatchCallback(fn) { _onCanonicalMismatch = fn; }

export function initFirebase() {
  if (db) return db; // already initialized

  // Check if already initialized by another module (safety check)
  if (getApps().length > 0) {
     db = getFirestore();
     try { storageBucket = getStorage().bucket(); } catch (e) { console.warn('⚠️ Storage bucket init failed (reuse):', e.message); }
     console.log("🔥 Firestore already initialized externally. Reusing instance.");
     return db;
  }

  // 1. Try local file (Dev)
  if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    try {
      const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf8"));
      initializeApp({ credential: cert(serviceAccount) });
      db = getFirestore();
      try { storageBucket = getStorage().bucket(); } catch (e) { console.warn('⚠️ Storage bucket init failed (local):', e.message); }
      console.log("🔥 Firestore Initialized (from local file)", SERVICE_ACCOUNT_PATH);
      return db;
    } catch (e) {
      console.error("🔥 Firestore Init Error (local):", e);
      db = null;
    }
  } 
  // 2. Try Env Var (Prod/CI)
  else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      // If content is JSON string
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS.trim().startsWith('{')) {
          const creds = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
          initializeApp({ credential: cert(creds) });
      } else {
          // If path
          const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
          if (fs.existsSync(keyPath)) {
             const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
             initializeApp({ credential: cert(serviceAccount) });
          } else {
             throw new Error(`File not found: ${keyPath}`);
          }
      }
      db = getFirestore();
      try { storageBucket = getStorage().bucket(); } catch (e) { console.warn('⚠️ Storage bucket init failed (env):', e.message); }
      console.log("🔥 Firestore Initialized (from env)");
      return db;
    } catch (e) {
      console.error("🔥 Firestore Init Error (env):", e);
      db = null;
    }
  } else {
    console.log("⚠️ No firebase-service-account.json found and no GOOGLE_APPLICATION_CREDENTIALS. Firestore sync disabled.");
  }
  return db;
}

function extractTs(msg) {
  // return JS Date object or null
  try {
    if (!msg) return null;
    let s = null;
    if (typeof msg.messageTimestamp === 'number') s = msg.messageTimestamp;
    else if (msg.message && typeof msg.message.messageTimestamp === 'number') s = msg.message.messageTimestamp;
    else if (msg.message && msg.message.timestamp) s = Number(msg.message.timestamp);
    else if (msg.messageTimestamp && typeof msg.messageTimestamp.low === 'number') s = Number(msg.messageTimestamp.low);
    if (s) return new Date(Number(s) * 1000);
  } catch (e) {}
  return new Date();
}

// ── Media: Upload to Firebase Storage ────────────────────────────────
const MIME_EXT_MAP = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov',
  'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
  'application/pdf': 'pdf', 'application/zip': 'zip',
};

function guessExt(mime) {
  if (!mime) return 'bin';
  const clean = mime.split(';')[0].trim();
  return MIME_EXT_MAP[clean] || clean.split('/')[1]?.replace(/[^a-zA-Z0-9]/g, '') || 'bin';
}

/**
 * Upload media buffer to Firebase Storage.
 * Makes the file publicly readable and returns a permanent public URL.
 * @param {Buffer} buffer - Media buffer
 * @param {string} convoId - Firestore conversation doc ID
 * @param {string} msgId - Message ID
 * @param {string} mime - MIME type
 * @param {number|null} size - File size in bytes
 * @param {string|null} fileName - Original filename
 * @returns {Promise<{path:string, bucket:string, mime:string, size:number, name:string|null, url:string}|null>}
 */
export async function uploadMediaToStorage(buffer, convoId, msgId, mime, size = null, fileName = null) {
  if (!storageBucket || !buffer || !convoId || !msgId) return null;

  const ext = guessExt(mime);
  const storagePath = `conversations/${convoId}/media/${msgId}.${ext}`;

  try {
    const file = storageBucket.file(storagePath);
    await file.save(buffer, {
      resumable: false,
      metadata: { contentType: mime || 'application/octet-stream' },
    });

    // Make file publicly readable (permanent URL, never expires)
    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${storageBucket.name}/${storagePath}`;

    return {
      path: storagePath,
      bucket: storageBucket.name,
      mime: mime || null,
      size: size || buffer.length,
      name: fileName || null,
      url: publicUrl,
    };
  } catch (e) {
    console.error(`[uploadMediaToStorage] Failed: ${e.message}`);
    return null;
  }
}

/**
 * Generate signed URL on-demand for a storage path.
 * @param {string} storagePath - Storage object path
 * @param {number} expiresInMs - Expiry duration (default 1 hour)
 * @returns {Promise<string|null>}
 */
export async function getSignedMediaUrl(storagePath, expiresInMs = 3600000) {
  if (!storageBucket || !storagePath) return null;
  try {
    const [url] = await storageBucket.file(storagePath).getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresInMs,
    });
    return url;
  } catch (e) {
    console.error(`[getSignedMediaUrl] Failed for ${storagePath}: ${e.message}`);
    return null;
  }
}

export async function syncMessageToFirestore(msg, canonicalJid, preview = '', chatName = '', accountId = null, accountLabel = '', options = {}) {
  try {
    if (!db) return;
    
    // Defensive ID
    const messageId = msg?.key?.id || msg?.id || options?.messageId || `local-${Date.now()}`;
    let rawJid = canonicalJid || (msg && msg.key && msg.key.remoteJid) || 'unknown';

    // ── Canonical JID Resolution ──────────────────────────────────────────
    // Use the shared resolveCanonicalJid function (passed via options or
    // imported) to ensure ALL Firestore writes use the same canonical ID.
    // This replaces the old LID-only normalization that caused duplicates.
    if (options.resolveCanonicalJid && typeof options.resolveCanonicalJid === 'function') {
      const resolved = options.resolveCanonicalJid(rawJid);
      if (resolved && resolved !== rawJid) {
        console.log(`[Canonical] Normalized ${rawJid} → ${resolved}`);
        rawJid = resolved;
      }
    } else {
      // Fallback: minimal LID normalization (backward compat)
      if (rawJid.endsWith('@lid')) {
        try {
          const LID_FILE = new URL('./lid_mappings.json', import.meta.url).pathname;
          const lidData = JSON.parse(fs.readFileSync(LID_FILE, 'utf8'));
          if (lidData[rawJid]) {
            console.log(`[LID→Phone] Normalizing ${rawJid} → ${lidData[rawJid]}`);
            rawJid = lidData[rawJid];
          }
        } catch (e) {
          // lid_mappings.json missing or unreadable — keep rawJid as-is
        }
      }
    }

    // Build conversation ID: accountId_canonicalJid
    // This ensures inbound and outbound messages land in the SAME Firestore doc.
    const convoId = accountId ? `${accountId}_${rawJid}` : rawJid;

    // ── Anti-amestec guardrail ────────────────────────────────────────
    // If the original JID differs from the resolved canonical, log it.
    // The onMismatch callback (set by main index) increments the Prometheus metric.
    const inputJid = canonicalJid || (msg?.key?.remoteJid) || 'unknown';
    if (inputJid !== rawJid) {
      console.warn(`[CANONICAL GUARD] Input JID "${inputJid}" was resolved to "${rawJid}" — convoId="${convoId}"`);
    }
    if (_onCanonicalMismatch && accountId) {
      const expected = `${accountId}_${rawJid}`;
      if (convoId !== expected) {
        _onCanonicalMismatch('syncMessageToFirestore', { inputJid, canonicalJid: rawJid, accountId, convoId, expected, msgId: messageId });
      }
    }

    console.log(`[syncMessageToFirestore] Syncing message: ${messageId} to convo: ${convoId}`);


    const convoRef = db.collection('conversations').doc(convoId);
    const messagesRef = convoRef.collection('messages').doc(messageId);

    // timestamp
    const tsDate = extractTs(msg) || new Date();
    const msgTimestamp = tsDate.getTime();

    // detect type & media
    let type = 'unknown';
    let mediaObj = options?.media || null; // Structured media object from Storage upload
    let mediaUrl = options?.mediaUrl || null; // Legacy flat URL (fallback)
    let mimetype = options?.mimetype || null;
    let photoUrl = options?.photoUrl || null;
    
    const content = msg && (msg.message || msg); // Handle both full msg and raw content
    if (content && typeof content === 'object') {
      type = Object.keys(content).find(k => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage') || type;

      // Only extract if not provided in options (or if we want to ensure mimetype)
      if (content.imageMessage) {
        if (!mimetype) mimetype = content.imageMessage.mimetype || 'image/jpeg';
        if (!mediaUrl) mediaUrl = content.imageMessage.url || content.imageMessage.directPath || null;
      } else if (content.videoMessage) {
        if (!mimetype) mimetype = content.videoMessage.mimetype || 'video/mp4';
        if (!mediaUrl) mediaUrl = content.videoMessage.url || content.videoMessage.directPath || null;
      } else if (content.documentMessage) {
        if (!mimetype) mimetype = content.documentMessage.mimetype || 'application/octet-stream';
        if (!mediaUrl) mediaUrl = content.documentMessage.url || content.documentMessage.directPath || null;
      } else if (content.stickerMessage) {
        if (!mimetype) mimetype = 'image/webp';
        // Sticker usually has no useful url for frontend without processing
      } else if (content.audioMessage) {
        if (!mimetype) mimetype = content.audioMessage.mimetype || 'audio/mp4';
        if (!mediaUrl) mediaUrl = content.audioMessage.url || null;
      }
    }

    const payload = {
      id: messageId,
      text: preview || '',
      fromMe: !!(msg?.key?.fromMe),
      pushName: msg?.pushName || '',
      type,
      metadata: {
        originJid: msg?.key?.remoteJid || null,
        participant: msg?.key?.participant || null,
      },
      timestamp: Timestamp.fromMillis(tsDate.getTime()),
      // Structured media object (preferred) or legacy flat fields
      ...(mediaObj ? { media: mediaObj } : {}),
      mediaUrl: mediaObj?.path ? null : (mediaUrl || null), // clear legacy if media{} present
      mimetype: mediaObj?.mime || mimetype || null,
    };

    // Atomic batch write/merge is better but sequential awaits are fine for now
    await messagesRef.set(payload, { merge: true });
    
    // CONVERSATION METADATA UPDATE
    const convoUpdate = {
        lastMessageAt: Timestamp.fromMillis(tsDate.getTime()),
        lastMessagePreview: payload.text || (type === 'imageMessage' ? '📷 Photo' : (type === 'videoMessage' ? '🎥 Video' : 'Media')),
        updatedAt: Timestamp.now(),
        jid: rawJid,
        canonicalJid: rawJid,
        accountId: accountId || null,
        accountLabel: accountLabel || ''
    };

    if (photoUrl) {
        convoUpdate.photoUrl = photoUrl;
    }

    // Only overwrite name if we actually have one (prevents nuking group names)
    if (chatName) {
        convoUpdate.name = chatName;
    }
    
    await convoRef.set(convoUpdate, { merge: true });
    return true;
  } catch (err) {
    console.error('[syncMessageToFirestore ERROR]', err && err.stack ? err.stack : err);
    // Don't crash the process
  }
}
