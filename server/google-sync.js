// google-sync.js (ESM)
// npm i googleapis
import { google } from "googleapis";
import fs from "fs";
import stream from "stream";

const KEYFILE = process.env.GOOGLE_KEYFILE || "./google-service-account.json";
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "";
const SHEET_CHATS = process.env.SHEET_CHATS || "chats";
const SHEET_MESSAGES = process.env.SHEET_MESSAGES || "messages";
const CHAT_BATCH_MS = Number(process.env.GOOGLE_CHAT_BATCH_MS || 5000);
const MSG_BATCH_MS = Number(process.env.GOOGLE_MSG_BATCH_MS || 5000);
const CHAT_BATCH_SIZE = Number(process.env.GOOGLE_CHAT_BATCH_SIZE || 200);
const MSG_BATCH_SIZE = Number(process.env.GOOGLE_MSG_BATCH_SIZE || 500);

if (!SPREADSHEET_ID) {
  console.warn("Warning: SPREADSHEET_ID not set. Google Sync will not work until you set it.");
}

let authClient = null;
let sheetsApi = null;
let driveApi = null;
let sheetIdCache = new Map(); // title -> sheetId

// chatCache: chatId -> { rowIndex, last_ts, last_message_id }
const chatCache = new Map();

// in-memory batches
let chatBatch = []; // array of {chatObj, resolve, reject}
let msgBatch = [];  // array of msgRow arrays

let chatFlushTimer = null;
let msgFlushTimer = null;

// small idempotency for messages (ephemeral)
const recentMessageIds = new Set();

// Initialize Google clients and cache
export async function initGoogleSync() {
  if (!SPREADSHEET_ID) {
    console.warn("Google Sync skipped: SPREADSHEET_ID not configured");
    return;
  }
  if (!fs.existsSync(KEYFILE)) {
    console.warn(`Google Sync skipped: Keyfile not found at ${KEYFILE}`);
    return;
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: KEYFILE,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
  });
  authClient = await auth.getClient();
  sheetsApi = google.sheets({ version: "v4", auth: authClient });
  driveApi = google.drive({ version: "v3", auth: authClient });

  await initChatCache(); // populate chatCache from sheet
  // start flush timers (lazy: only schedule when batch added)
  console.log("Google Sync initialized. Chat cache size:", chatCache.size);
}

// Build chatCache by reading A2:J (chat_id .. last_message_id)
async function initChatCache() {
  try {
    const range = `${SHEET_CHATS}!A2:J`;
    const resp = await sheetsApi.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range,
    });
    const rows = resp.data.values || [];
    chatCache.clear();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIndex = i + 2; // because A2 starts
      const chatId = row[0];
      if (!chatId) continue;
      const last_ts = Number(row[7] || 0); // H index 7
      const last_message_id = row[9] || ""; // J index 9
      chatCache.set(chatId, { rowIndex, last_ts, last_message_id });
    }
  } catch (e) {
    console.error("initChatCache error:", e.message || e);
    chatCache.clear();
  }
}

// Helper: get sheetId for a sheet title
async function getSheetId(sheetTitle) {
  if (sheetIdCache.has(sheetTitle)) return sheetIdCache.get(sheetTitle);
  const meta = await sheetsApi.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = meta.data.sheets.find(s => s.properties.title === sheetTitle);
  if (!sheet) throw new Error(`Sheet ${sheetTitle} not found`);
  const id = sheet.properties.sheetId;
  sheetIdCache.set(sheetTitle, id);
  return id;
}

// Upsert chat (non-blocking: returns Promise resolved when scheduled)
export function upsertChatInGoogle(chatObj) {
  // chatObj keys:
  // chat_id, is_group (bool), phone, name, last_message_text, last_message_type,
  // last_sender_name, last_message_ts (numeric), unread_count, last_message_id, media_link
  return new Promise((resolve, reject) => {
    try {
      // idempotency check against chatCache: if exists and incoming ts <= cached ts, no-op
      const cached = chatCache.get(chatObj.chat_id);
      if (cached && Number(chatObj.last_message_ts || 0) <= Number(cached.last_ts || 0)) {
        return resolve({ skipped: true });
      }
      // push into batch
      chatBatch.push({ chatObj, resolve, reject });
      if (chatBatch.length >= CHAT_BATCH_SIZE) {
        flushChatBatch().catch(e => console.error("flushChatBatch error:", e));
      } else if (!chatFlushTimer) {
        chatFlushTimer = setTimeout(() => { chatFlushTimer = null; flushChatBatch().catch(e => console.error(e)); }, CHAT_BATCH_MS);
      }
    } catch (e) {
      reject(e);
    }
  });
}

// Append message row to messages sheet (idempotent best-effort)
export function appendMessageRow(msgRow) {
  // msgRow: [iso_ts, message_id, chat_id, from_me, sender_name, text, type, media_link]
  return new Promise((resolve, reject) => {
    try {
      const messageId = msgRow[1];
      if (recentMessageIds.has(messageId)) return resolve({ skipped: true });
      // push and schedule
      msgBatch.push({ msgRow, resolve, reject });
      if (msgBatch.length >= MSG_BATCH_SIZE) {
        flushMessageBatch().catch(e => console.error("flushMessageBatch error:", e));
      } else if (!msgFlushTimer) {
        msgFlushTimer = setTimeout(() => { msgFlushTimer = null; flushMessageBatch().catch(e => console.error(e)); }, MSG_BATCH_MS);
      }
    } catch (e) {
      reject(e);
    }
  });
}

// Internal: flush chat batch
async function flushChatBatch() {
  if (!sheetsApi) return; // Silent exit if not initialized
  if (chatFlushTimer) { clearTimeout(chatFlushTimer); chatFlushTimer = null; }
  const batch = chatBatch.splice(0, chatBatch.length);
  if (batch.length === 0) return;
  // We will process sequentially: for each chatObj, either update row or append new
  for (const item of batch) {
    const { chatObj, resolve, reject } = item;
    try {
      const existing = chatCache.get(chatObj.chat_id);
      const valuesRow = [[
        chatObj.chat_id || "",
        chatObj.is_group ? "TRUE" : "FALSE",
        chatObj.phone || "",
        chatObj.name || "",
        chatObj.last_message_text || "",
        chatObj.last_message_type || "",
        chatObj.last_sender_name || "",
        String(chatObj.last_message_ts || 0),
        Number(chatObj.unread_count || 0),
        chatObj.last_message_id || "",
        chatObj.media_link || ""
      ]];
      if (existing) {
        // update only if newer
        if (Number(chatObj.last_message_ts || 0) > Number(existing.last_ts || 0)) {
          const range = `${SHEET_CHATS}!A${existing.rowIndex}:K${existing.rowIndex}`;
          await sheetsApi.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range,
            valueInputOption: "RAW",
            requestBody: { values: valuesRow }
          });
          // update cache
          chatCache.set(chatObj.chat_id, { rowIndex: existing.rowIndex, last_ts: Number(chatObj.last_message_ts || 0), last_message_id: chatObj.last_message_id || "" });
        } else {
          // skipped
        }
      } else {
        // append
        const appendResp = await sheetsApi.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_CHATS}!A:K`,
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: valuesRow }
        });
        let rowIndex = null;
        const updatedRange = appendResp.data.updates?.updatedRange;
        if (updatedRange) {
          const m = updatedRange.match(/A(\d+):K\d+/);
          if (m) rowIndex = Number(m[1]);
        }
        if (!rowIndex) {
          // fallback: get length of A column
          const meta = await sheetsApi.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_CHATS}!A:A` });
          rowIndex = (meta.data.values || []).length;
        }
        chatCache.set(chatObj.chat_id, { rowIndex, last_ts: Number(chatObj.last_message_ts || 0), last_message_id: chatObj.last_message_id || "" });
      }
      resolve({ ok: true });
    } catch (e) {
      console.error("upsertChatInGoogle item error:", e.message || e);
      reject(e);
    }
  }
  // after batch, sort chats by last_message_ts
  try {
    await sortChatsByLastMessageTs();
  } catch (e) {
    console.warn("sortChatsByLastMessageTs error:", e.message || e);
  }
}

// Internal: flush message batch
async function flushMessageBatch() {
  if (!sheetsApi) return; // Silent exit if not initialized
  if (msgFlushTimer) { clearTimeout(msgFlushTimer); msgFlushTimer = null; }
  const batch = msgBatch.splice(0, msgBatch.length);
  if (batch.length === 0) return;
  const rows = [];
  const resolves = [];
  const rejects = [];
  for (const it of batch) {
    rows.push(it.msgRow);
    resolves.push(it.resolve);
    rejects.push(it.reject);
  }
  try {
    await sheetsApi.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_MESSAGES}!A:H`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows }
    });
    // mark message ids in recent set for idempotency (best-effort)
    for (const r of rows) {
      const mid = r[1];
      if (mid) recentMessageIds.add(mid);
    }
    // resolve
    for (const res of resolves) try { res({ ok: true }); } catch (_) {}
  } catch (e) {
    console.error("flushMessageBatch error:", e.message || e);
    for (const rej of rejects) try { rej(e); } catch (_) {}
    // simple retry: requeue whole batch at end
    msgBatch.unshift(...batch);
    setTimeout(() => flushMessageBatch().catch(err => console.error("retry flushMessageBatch failed", err)), 5000);
  }
}

// Sort chats sheet desc by column H (index 7)
export async function sortChatsByLastMessageTs() {
  if (!sheetsApi) return;
  const sheetId = await getSheetId(SHEET_CHATS);
  const requests = [{
    sortRange: {
      range: {
        sheetId,
        startRowIndex: 1, // skip header row
        startColumnIndex: 0,
        endColumnIndex: 11
      },
      sortSpecs: [{ dimensionIndex: 7, sortOrder: "DESCENDING" }]
    }
  }];
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests }
  });
}

// Helper: get sheetId for a sheet title (using cache)
// (Implementation already provided above at line 83)

// Upload buffer to Drive, return view link
export async function uploadBufferToDrive(filename, mimeType, buffer) {
  if (!driveApi) throw new Error("Drive client not initialized");
  const pass = new stream.PassThrough();
  pass.end(buffer);
  try {
    const res = await driveApi.files.create({
      requestBody: { name: filename, mimeType },
      media: { mimeType, body: pass },
      fields: "id",
    });
    const fileId = res.data.id;
    try {
      await driveApi.permissions.create({ fileId, requestBody: { role: "reader", type: "anyone" } });
    } catch (e) {
      console.warn("Could not set public permission:", e.message || e);
    }
    return `https://drive.google.com/uc?export=view&id=${fileId}`;
  } catch (e) {
    console.error("uploadBufferToDrive error:", e.message || e);
    throw e;
  }
}

// Expose flush for graceful shutdown/testing
export async function flushAll() {
  await flushChatBatch();
  await flushMessageBatch();
}

// Export
export default {
  initGoogleSync,
  upsertChatInGoogle,
  appendMessageRow,
  flushAll,
  uploadBufferToDrive
};
