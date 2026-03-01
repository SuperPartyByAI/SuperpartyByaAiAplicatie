import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import { URL } from 'url';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ilkphpidhuytucxlglqi.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_KEY) {
    console.error("🚨 CRITICAL: SUPABASE_SERVICE_KEY is missing from environment variables!");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export let db = null;
export let storageBucket = null;

export function getAuth() {
  return {}; 
}

let _onCanonicalMismatch = null;
export function setCanonicalMismatchCallback(fn) { _onCanonicalMismatch = fn; }

export function initFirebase() {
  console.log("🔥 Supabase Sync Adapter initialized successfully.");
  return supabase;
}

function extractTs(msg) {
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

export async function uploadMediaToStorage(mimetype, buffer, filename) {
  try {
    const bucket = 'whatsapp-media';
    const filePath = `received/${filename}`;
    
    const { data, error } = await supabase.storage.from(bucket).upload(filePath, buffer, {
      contentType: mimetype,
      upsert: true
    });
    
    if (error) throw error;
    
    console.log(`[Supabase Storage] Success: ${filePath}`);
    return {
      path: filePath,
      bucket: bucket,
      mime: mimetype || null,
      size: buffer.length,
      name: filename || null,
      url: `https://ilkphpidhuytucxlglqi.supabase.co/storage/v1/object/public/${bucket}/${filePath}`
    };
  } catch (error) {
    console.error("[Supabase Storage] Upload error", error);
    return null;
  }
}

export async function getSignedMediaUrl(path, ttlMs = 3600000) {
  try {
    const expiresInSeconds = Math.floor(ttlMs / 1000);
    const { data, error } = await supabase.storage.from('whatsapp-media').createSignedUrl(path, expiresInSeconds);
    
    if (error) throw error;
    return data.signedUrl;
  } catch (error) {
    console.error(`Error resolving signed URL for ${path}:`, error);
    return null;
  }
}

export async function syncMessageToFirestore(msg, canonicalJid, preview = '', chatName = '', accountId = null, accountLabel = '', options = {}) {
  try {
    const messageId = msg?.key?.id || msg?.id || options?.messageId || `local-${Date.now()}`;
    let rawJid = canonicalJid || (msg && msg.key && msg.key.remoteJid) || 'unknown';

    if (options.resolveCanonicalJid && typeof options.resolveCanonicalJid === 'function') {
      const resolved = options.resolveCanonicalJid(rawJid);
      if (resolved && resolved !== rawJid) {
        console.log(`[Canonical] Normalized ${rawJid} → ${resolved}`);
        rawJid = resolved;
      }
    } else {
      if (rawJid.endsWith('@lid')) {
        try {
          const LID_FILE = new URL('./lid_mappings.json', import.meta.url).pathname;
          const lidData = JSON.parse(fs.readFileSync(LID_FILE, 'utf8'));
          if (lidData[rawJid]) rawJid = lidData[rawJid];
        } catch (e) {}
      }
    }

    const convoId = accountId ? `${accountId}_${rawJid}` : rawJid;
    const inputJid = canonicalJid || (msg?.key?.remoteJid) || 'unknown';
    if (_onCanonicalMismatch && accountId) {
      const expected = `${accountId}_${rawJid}`;
      if (convoId !== expected) {
        _onCanonicalMismatch('syncMessageToFirestore', { inputJid, canonicalJid: rawJid, accountId, convoId, expected, msgId: messageId });
      }
    }

    console.log(`[SupabaseSync] Syncing msg: ${messageId} to convo ${convoId}`);
    const tsDate = extractTs(msg) || new Date();

    let type = 'text';
    let mediaObj = options?.media || null; 
    let mediaUrl = options?.mediaUrl || null; 
    let mimetype = options?.mimetype || null;
    let photoUrl = options?.photoUrl || null;
    
    const content = msg && (msg.message || msg); 
    if (content && typeof content === 'object') {
      type = Object.keys(content).find(k => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage') || type;
      if (content.imageMessage) {
        if (!mimetype) mimetype = content.imageMessage.mimetype || 'image/jpeg';
        if (!mediaUrl) mediaUrl = content.imageMessage.url || content.imageMessage.directPath || null;
      } else if (content.videoMessage) {
        if (!mimetype) mimetype = content.videoMessage.mimetype || 'video/mp4';
      } else if (content.documentMessage) {
        if (!mimetype) mimetype = content.documentMessage.mimetype || 'application/octet-stream';
      } else if (content.audioMessage) {
        if (!mimetype) mimetype = content.audioMessage.mimetype || 'audio/mp4';
      }
    }

    const payload = {
      id: messageId,
      conversation_id: convoId,
      body: preview || '',
      type: type,
      timestamp: tsDate.toISOString(),
      direction: msg?.key?.fromMe ? 'outbound' : 'inbound',
      pushName: msg?.pushName || '',
      from: msg?.key?.remoteJid || null,
      mediaPath: mediaObj?.path || mediaUrl || null
    };

    const { error: msgErr } = await supabase.from('messages').upsert(payload, { onConflict: 'id', ignoreDuplicates: false });
    if (msgErr) console.error('[SupabaseSync] msg insert error', msgErr);

    const convoUpdate = {
        id: convoId,
        last_active: tsDate.toISOString(),
        last_message: payload.body,
    };
    if (chatName) convoUpdate.name = chatName;

    const { error: convErr } = await supabase.from('conversations').upsert(convoUpdate, { onConflict: 'id' });
    if (convErr) console.error('[SupabaseSync] conv upsert error', convErr);

    return true;
  } catch (err) {
    console.error('[SupabaseSync ERROR]', err && err.stack ? err.stack : err);
    return false;
  }
}

// --- FIRESTORE MOCK ---
class SupabaseDocMock {
  constructor(client, colName, docId) {
    this.client = client;
    this.colName = colName;
    this.documentId = docId || ('local-' + Date.now());
    this.id = this.documentId;
  }
  collection(subColName) { return new SupabaseCollectionMock(this.client, subColName); }
  async get() {
    if (!this.documentId) return { exists: false, data: () => null };
    const { data, error } = await this.client.from(this.colName).select('*').eq('id', this.documentId).maybeSingle();
    if (error || !data) return { exists: false, data: () => null };
    return { id: data.id, exists: true, data: () => data };
  }
  async set(payload, options = {}) {
    const finalPayload = { id: this.documentId, ...payload };
    for (const [k, v] of Object.entries(finalPayload)) {
       if (v && typeof v === 'object' && v.isEqual) finalPayload[k] = new Date().toISOString(); 
    }
    await this.client.from(this.colName).upsert(finalPayload, { onConflict: 'id' });
  }
  async update(payload) {
    const finalPayload = { ...payload };
    for (const [k, v] of Object.entries(finalPayload)) {
       if (v && typeof v === 'object' && v.isEqual) finalPayload[k] = new Date().toISOString(); 
    }
    await this.client.from(this.colName).update(finalPayload).eq('id', this.documentId);
  }
}

class SupabaseCollectionMock {
  constructor(client, colName) {
    this.client = client;
    this.colName = colName;
    this.queryFilters = [];
    this.queryLimit = null;
    this.queryOrder = null;
  }
  doc(docId) { return new SupabaseDocMock(this.client, this.colName, docId); }
  where(field, op, val) {
    this.queryFilters.push({ field, op, val });
    return this;
  }
  orderBy(field, dir = 'asc') {
    this.queryOrder = { field, dir };
    return this;
  }
  limit(n) {
    this.queryLimit = n;
    return this;
  }
  async get() {
    let q = this.client.from(this.colName).select('*');
    for (const f of this.queryFilters) {
      if (f.op === '==' || f.op === '===') q = q.eq(f.field, f.val);
      else if (f.op === 'in') q = q.in(f.field, f.val);
    }
    if (this.queryOrder) q = q.order(this.queryOrder.field, { ascending: this.queryOrder.dir !== 'desc' });
    if (this.queryLimit) q = q.limit(this.queryLimit);
    
    const { data, error } = await q;
    if (error) {
      console.error('[Mock DB get Error]', error);
      return { empty: true, docs: [] };
    }
    const docs = (data || []).map(row => ({ id: row.id, exists: true, data: () => row }));
    return { empty: docs.length === 0, docs, size: docs.length };
  }
  async add(payload) {
    const finalPayload = { ...payload };
    for (const [k, v] of Object.entries(finalPayload)) {
       if (v && typeof v === 'object' && v.isEqual) finalPayload[k] = new Date().toISOString(); 
    }
    const { data, error } = await this.client.from(this.colName).insert(finalPayload).select().single();
    if (error) { console.error(error); return new SupabaseDocMock(this.client, this.colName, 'err'); }
    return new SupabaseDocMock(this.client, this.colName, data.id);
  }
}

class SupabaseFirestoreMock {
  constructor(client) { this.client = client; }
  collection(colName) { return new SupabaseCollectionMock(this.client, colName); }
  collectionGroup(colName) { return new SupabaseCollectionMock(this.client, colName); }
}

export function initFirebaseMock() {
  console.log("🔥 Supabase Sync Adapter (MOCK) initialized successfully.");
  return new SupabaseFirestoreMock(supabase);
}
