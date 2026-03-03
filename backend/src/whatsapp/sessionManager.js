const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { db, FieldValue } = require('../supabase');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const { handleMessageUpsert } = require('./events');

// Global State
const sessions = new Map(); // accountId -> socket
const sessionsInProgress = new Set(); // accountId
const reconnectDelays = new Map(); // accountId -> ms delay
const reconnectTimers = new Map(); // accountId -> Timeout

const SESSIONS_DIR = path.join(__dirname, '../../sessions');

if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

async function createSession(accountId) {
  // 1. Prevent overlapping creation
  if (sessionsInProgress.has(accountId)) {
    console.log(`Session creation for ${accountId} already in progress.`);
    return;
  }
  sessionsInProgress.add(accountId);

  try {
    // 2. Cleanup existing socket
    if (sessions.has(accountId)) {
      const oldSock = sessions.get(accountId);
      try {
        oldSock.end(undefined); // Close connection
        oldSock.ws.close();
      } catch (e) {
        // ignore
      }
      sessions.delete(accountId);
      console.log(`Closed pending session for ${accountId}`);
    }

    const sessionPath = path.join(SESSIONS_DIR, accountId);
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
    });

    sessions.set(accountId, sock);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log(`QR received for ${accountId}`);
        await db.collection('wa_accounts').doc(accountId).set({ 
          qrCode: qr, 
          status: 'scanning',
          id: accountId,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true }).catch(err => console.error('Failed to update QR', err));
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        console.log(`Connection closed for ${accountId} (Status: ${statusCode}). Reconnecting: ${shouldReconnect}`);

        sessions.delete(accountId);
        
        // Handle Bad Session
        if (statusCode === DisconnectReason.badSession) {
          console.error(`Bad session for ${accountId}. Deleting session and requesting new QR.`);
          try {
            await fs.promises.rm(path.join(SESSIONS_DIR, accountId), { recursive: true, force: true });
          } catch (e) {
            console.error(`Failed to delete session folder for ${accountId}`, e);
          }
          
          await db.collection('wa_accounts').doc(accountId).set({
              status: 'needs_qr',
              qrCode: null,
              id: accountId,
              updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });

          // Re-create session to generate new QR
          resetBackoff(accountId);
          createSession(accountId);
          return;
        }

        if (shouldReconnect) {
          handleReconnectWithBackoff(accountId);
        } else {
          console.log(`Account ${accountId} logged out.`);
          resetBackoff(accountId);
          await db.collection('wa_accounts').doc(accountId).set({ 
              status: 'disconnected',
              updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });
        }
      } else if (connection === 'open') {
        console.log(`Connection opened for ${accountId}`);
        resetBackoff(accountId);

        // 3. Save Identity
        const me = sock.user || sock.authState?.creds?.me;
        const jid = me?.id;
        const phoneNumber = jid?.split('@')[0] || '';

        await db.collection('wa_accounts').doc(accountId).set({ 
          status: 'connected', 
          qrCode: null,
          jid,
          phoneNumber,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true }).catch(err => console.error('Failed to update account identity', err));
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // 4. Message Handling
    sock.ev.on('messages.upsert', (data) => handleMessageUpsert(accountId, data));

  } catch (error) {
    console.error(`Failed to create session for ${accountId}`, error);
    handleReconnectWithBackoff(accountId);
  } finally {
    sessionsInProgress.delete(accountId);
  }
}

function handleReconnectWithBackoff(accountId) {
  // Prevent duplicate timers
  if (reconnectTimers.has(accountId)) {
      return;
  }

  let delay = reconnectDelays.get(accountId) || 2000; // Start 2s
  console.log(`Scheduling reconnect for ${accountId} in ${delay}ms`);

  const timer = setTimeout(() => {
    reconnectTimers.delete(accountId);
    createSession(accountId);
  }, delay);

  reconnectTimers.set(accountId, timer);

  // Increase delay for next time, cap at 60s
  delay = Math.min(delay * 2, 60000);
  reconnectDelays.set(accountId, delay);
}

function resetBackoff(accountId) {
  if (reconnectTimers.has(accountId)) {
      clearTimeout(reconnectTimers.get(accountId));
      reconnectTimers.delete(accountId);
  }
  reconnectDelays.delete(accountId);
}

// Get Active Socket
function getSessionSocket(accountId) {
  return sessions.get(accountId);
}

async function initSessions() {
  const snapshot = await db.collection('wa_accounts').get();
  snapshot.forEach(doc => {
    const data = doc.data();
    // Only restore if not explicitly disconnected or if we policy allows
    if (data.status !== 'disconnected') {
      createSession(doc.id);
    }
  });
}

module.exports = { createSession, initSessions, getSessionSocket };
