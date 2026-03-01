const admin = require('firebase-admin');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const mime = require('mime-types');

/**
 * Firestore/Storage sync helpers
 */

let db = null;
let bucket = null;
let initialized = false;

function initFirebase({ serviceAccount, storageBucket } = {}) {
  if (initialized) return;
  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: storageBucket
    });
  } else {
    if (!admin.apps.length) {
        admin.initializeApp({
            storageBucket: storageBucket
        });
    }
  }
  db = admin.firestore();
  bucket = admin.storage().bucket(storageBucket || admin.storage().bucket().name);
  initialized = true;
}

async function findOrCreateConversation(canonicalJid, extra = {}) {
  if (!initialized) {
      if (admin.apps.length) {
          db = admin.firestore();
          // bucket = admin.storage().bucket(); 
          initialized = true;
      } else {
          throw new Error('Firestore not initialized. Call initFirebase() first.');
      }
  }
  if (!canonicalJid) throw new Error('Missing canonicalJid');

  // Try to find by JID (Canonical)
  let q = await db.collection('conversations').where('jid', '==', canonicalJid).limit(1).get();
  
  // Fallback: Try to find by clientId (Legacy schema) if not found
  if (q.empty) {
      q = await db.collection('conversations').where('clientId', '==', canonicalJid).limit(1).get();
  }

  if (!q.empty) {
    // Optional: Update with new fields if they are missing?
    // For now just return ID
    return q.docs[0].id;
  }

  const now = admin.firestore.Timestamp.now();
  // We can use a deterministic ID or Auto-ID. 
  // Existing system uses `${accountId}_${clientId}`. 
  // If we have accountId in extra, we could try to maintain that pattern OR just use Auto-ID.
  // The user's request implies a move to a more standard structure, so Auto-ID is safer for pure canonical JIDs.
  const docRef = db.collection('conversations').doc();
  await docRef.set({
    jid: canonicalJid,
    createdAt: now,
    updatedAt: now,
    ...extra
  });
  return docRef.id;
}

// ... extractMessageText ...
function extractMessageText(m) {
  if (!m) return '';
  if (m.messageStubType) {
    const types = {
      'GROUP_PARTICIPANT_LEAVE': '🚪 Participant Left',
      'GROUP_PARTICIPANT_ADD': '👋 Participant Added'
    };
    return types[m.messageStubType] || `System: ${m.messageStubType}`;
  }
  if (!m.message) return '';
  if (m.message.conversation) return m.message.conversation;
  if (m.message.extendedTextMessage?.text) return m.message.extendedTextMessage.text;
  if (m.message.imageMessage) return m.message.imageMessage.caption || '📷 Photo';
  if (m.message.videoMessage) return m.message.videoMessage.caption || '🎥 Video';
  if (m.message.documentMessage) return m.message.documentMessage.title || '📄 Document';
  if (m.message.stickerMessage) return '🧩 Sticker';
  if (m.message.locationMessage) return '📍 Location';
  if (m.message.contactMessage) return '👤 Contact';
  return '';
}

async function uploadMediaBuffer(convId, msgId, buffer, mimeType) {
  if (!bucket) {
       bucket = admin.storage().bucket();
  }
  if (!bucket) throw new Error('Storage bucket not initialized');
  
  const ext = mime.extension(mimeType) || 'bin';
  const remotePath = `conversations/${convId}/messages/${msgId}/media.${ext}`;
  const file = bucket.file(remotePath);

  await file.save(buffer, { contentType: mimeType, resumable: false });
  const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 1000 * 60 * 60 * 24 * 365 }); 
  return { url, mime: mimeType, size: buffer.length, path: remotePath };
}

async function saveMessageToFirestore(convId, messageObj) {
  if (!db) db = admin.firestore();

  if (!messageObj || !messageObj.keyId) throw new Error('Missing message keyId');

  const msgRef = db.collection('conversations').doc(convId).collection('messages').doc(messageObj.keyId);
  const doc = await msgRef.get();
  if (doc.exists) {
    return { skipped: true };
  }

  const tsSeconds = messageObj.ts ? Number(messageObj.ts) : Math.floor(Date.now() / 1000);
  const timestamp = admin.firestore.Timestamp.fromMillis(tsSeconds * 1000);

  const data = {
    id: messageObj.keyId,
    keyId: messageObj.keyId,
    direction: messageObj.direction || (messageObj.fromMe ? 'outbound' : 'inbound'),
    fromMe: !!messageObj.fromMe,
    sender: messageObj.sender || null,
    pushName: messageObj.pushName || null,
    text: messageObj.text || '',
    timestamp,
    type: messageObj.type || 'text',
    raw: messageObj.baileysRaw || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  // Add accountId if present (for filtering)
  if (messageObj.accountId) {
      data.accountId = messageObj.accountId;
  }

  if (messageObj.mediaBuffer && messageObj.mediaMime) {
    try {
      const mediaInfo = await uploadMediaBuffer(convId, messageObj.keyId, messageObj.mediaBuffer, messageObj.mediaMime);
      data.media = {
        url: mediaInfo.url,
        mime: mediaInfo.mime,
        size: mediaInfo.size,
        path: mediaInfo.path
      };
    } catch (e) {
      console.error('Media upload failed for', messageObj.keyId, e);
    }
  }

  await msgRef.set(data);

  const convoRef = db.collection('conversations').doc(convId);
  const lastPreview = (data.text && data.text.length > 0) ? data.text.slice(0, 200) : (data.type || '');
  
  const updateData = {
    lastMessageAt: timestamp,
    lastMessagePreview: lastPreview,
    lastMessageSender: data.pushName || data.sender || null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  
  // Ensure conversation has accountId if not already
  if (messageObj.accountId) {
      updateData.accountId = messageObj.accountId;
  }

  await convoRef.set(updateData, { merge: true });

  return { skipped: false };
}

async function processBaileysMessage(msg, { resolveCanonicalJidFn = null, downloadMedia = true, accountId = null } = {}) {
  if (!msg || !msg.key || !msg.key.id) return null;

  const keyId = msg.key.id;
  const remoteJid = msg.key.remoteJid || (msg.key.participant ? msg.key.participant : null);
  const fromMe = !!msg.key.fromMe;
  const sender = msg.key.participant || msg.key.remoteJid || null;
  const pushName = msg.pushName || (msg.sender && msg.sender.name) || null;
  const text = extractMessageText(msg);
  const ts = (() => {
    if (msg.messageTimestamp) return Number(msg.messageTimestamp);
    if (msg.message && msg.message.messageTimestamp) return Number(msg.message.messageTimestamp);
    if (msg.message && msg.message.messageTimestamp && msg.message.messageTimestamp.low) return Number(msg.message.messageTimestamp.low);
    if (msg.messageTimestamp && msg.messageTimestamp.low) return Number(msg.messageTimestamp.low);
    if (msg.timestamp) return Number(msg.timestamp);
    if (msg.t) return Number(msg.t);
    return Math.floor(Date.now() / 1000);
  })();

  const canonicalJid = resolveCanonicalJidFn ? await resolveCanonicalJidFn(remoteJid) : remoteJid;
  if (!canonicalJid) {
    console.warn('Cannot resolve canonical jid for message', keyId, remoteJid);
    return null;
  }

  const convId = await findOrCreateConversation(canonicalJid, { 
      accountId, 
      clientId: canonicalJid // fallback compliance
  });

  const messageObj = {
    keyId,
    direction: fromMe ? 'outbound' : 'inbound',
    fromMe,
    sender,
    pushName,
    text,
    ts,
    type: 'text',
    baileysRaw: msg,
    accountId // pass context
  };

  const message = msg.message || {};
  const mediaKinds = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
  for (const k of mediaKinds) {
    if (message[k]) {
      messageObj.type = k.replace('Message', '').toLowerCase();
      messageObj.mediaMime = message[k].mimetype || message[k].mimeType || null;
      if (message[k].caption) messageObj.text = message[k].caption;
      if (downloadMedia) {
        try {
          const buffer = await downloadMediaMessage(msg, 'buffer', {});
          if (buffer && Buffer.isBuffer(buffer)) {
            messageObj.mediaBuffer = buffer;
            if (!messageObj.mediaMime && message[k].mimetype) messageObj.mediaMime = message[k].mimetype;
          }
        } catch (e) {
           // silent fail
        }
      }
      break;
    }
  }

  const res = await saveMessageToFirestore(convId, messageObj);
  return { convId, res };
}

module.exports = {
    initFirebase,
    findOrCreateConversation,
    extractMessageText,
    saveMessageToFirestore,
    processBaileysMessage
};
