#!/usr/bin/env node
const fs = require('fs');
const readline = require('readline');
const { exec } = require('child_process');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
const yargs = require('yargs');

const argv = yargs
  .option('log-file', { type: 'string', describe: 'Path to baileys/pm2 log file to parse' })
  .option('pm2', { type: 'boolean', describe: 'Capture pm2 logs live (requires pm2 installed on host where script runs)' })
  .option('lines', { type: 'number', default: 5000, describe: 'Number of pm2 log lines to fetch when using --pm2' })
  .option('from', { type: 'string', describe: 'From ISO timestamp (inclusive)' })
  .option('to', { type: 'string', describe: 'To ISO timestamp (inclusive)' })
  .option('phone_id', { type: 'string', describe: 'Filter by phone_id (optional)' })
  .option('out', { type: 'string', default: './replay_report.json', describe: 'Output report JSON file' })
  .option('antigravity', { type: 'boolean', describe: 'Also fetch Antigravity route logs via API (requires ANTIGRAVITY_BASE & ANTIGRAVITY_TOKEN)' })
  .option('route_id', { type: 'string', describe: 'Antigravity route id to fetch logs for (optional)' })
  .option('dry_run', { type: 'boolean', default: false })
  .help()
  .argv;

const svcPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!svcPath || !fs.existsSync(svcPath)) {
  console.error('ERROR: FIREBASE_SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS is required and must point to a valid file.');
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(require(svcPath)),
});
const db = admin.firestore();

function isoToMs(iso) {
  return iso ? new Date(iso).getTime() : null;
}

function withinWindow(ts, fromMs, toMs) {
  if (!ts) return false;
  const ms = new Date(ts).getTime();
  if (fromMs && ms < fromMs) return false;
  if (toMs && ms > toMs) return false;
  return true;
}

function normalizeMsg(event) {
  const out = {
    message_id: null,
    conversation_id: null,
    from: null,
    to: null,
    timestamp: null,
    fromMe: null,
    direction: null,
    content: null,
    origin: null,
    raw: event
  };

  let msg = null;
  if (Array.isArray(event.messages) && event.messages.length) {
    msg = event.messages[0];
  } else if (Array.isArray(event.message)) {
    msg = event.message[0];
  } else if (event.message) {
    msg = event.message;
  } else if (event.payload && event.payload.messages) {
    msg = event.payload.messages[0];
  } else if (event.payload && event.payload.message) {
    msg = event.payload.message;
  } else if (event.type && /message/i.test(event.type) && event.data) {
    msg = event.data;
  } else {
    msg = event;
  }

  try {
    out.message_id = (msg && (msg.key && msg.key.id)) || msg.id || msg.messageId || msg.msgId || event.id || event.message_id || null;

    out.from = (msg && (msg.key && (msg.key.remoteJid || msg.key.participant || msg.key.from))) || msg.from || event.from || event.sender || null;
    out.to = (msg && (msg.key && msg.key.remoteJid)) || msg.to || event.to || null;

    if (typeof msg.fromMe === 'boolean') out.fromMe = msg.fromMe;
    else if (msg.key && typeof msg.key.fromMe === 'boolean') out.fromMe = msg.key.fromMe;
    else out.fromMe = !!(msg && msg.fromMe) || !!(event && event.fromMe);

    const tsCandidates = [
      msg && msg.messageTimestamp,
      msg && msg.t,
      msg && msg.timestamp,
      event && event.timestamp,
      msg && msg.serverTimestamp,
      event && event.time
    ];
    for (const c of tsCandidates) {
      if (c) {
        const n = Number(c);
        if (!Number.isNaN(n)) {
          out.timestamp = (n > 9999999999 ? new Date(n).toISOString() : new Date(n * 1000).toISOString());
          break;
        } else if (typeof c === 'string' && Date.parse(c)) {
          out.timestamp = new Date(c).toISOString();
          break;
        }
      }
    }
    if (!out.timestamp) out.timestamp = new Date().toISOString();

    let text = null;
    const m = msg && (msg.message || msg);
    if (m) {
      if (m.conversation) text = m.conversation;
      else if (m.extendedTextMessage && m.extendedTextMessage.text) text = m.extendedTextMessage.text;
      else if (m.extendedTextMessage && m.extendedTextMessage.contextInfo && m.extendedTextMessage.contextInfo.quotedMessage) {
        text = m.extendedTextMessage.text;
      } else if (m.message && typeof m.message === 'string') text = m.message;
      else if (typeof m === 'string') text = m;
      else if (m.text) text = m.text;
      else {
        text = JSON.stringify(m).slice(0, 1000);
      }
    }
    out.content = { text: text || null };

    out.origin = event.origin || event.source || (event._source || 'baileys');
    out.direction = out.fromMe ? 'outbound' : 'inbound';
    out.conversation_id = (msg && msg.key && msg.key.remoteJid) || msg.remoteJid || event.conversation_id || out.to || out.from;
  } catch (e) {
    out.raw_parse_error = e.message;
  }

  return out;
}

async function insertMessageNormalized(doc) {
  let docId = doc.message_id || `${doc.conversation_id}_${new Date(doc.timestamp).getTime()}_${Math.random().toString(36).slice(2,8)}`;
  const ref = db.collection('messages').doc(docId);
  try {
    const snap = await ref.get();
    if (snap.exists) {
      return { status: 'exists', docId };
    }
    const store = {
      message_id: doc.message_id || docId,
      conversation_id: doc.conversation_id,
      from: doc.from,
      to: doc.to,
      timestamp: doc.timestamp,
      fromMe: !!doc.fromMe,
      direction: doc.direction,
      content: doc.content || null,
      origin: doc.origin || 'baileys',
      route_id: doc.route_id || null,
      binding_id: doc.binding_id || null,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      raw: doc.raw || null
    };
    if (!argv.dry_run) {
      await ref.set(store);
    }
    return { status: 'inserted', docId };
  } catch (err) {
    return { status: 'error', error: err.message, docId };
  }
}

async function processLineEvent(eventObj, accum) {
  const candidateMessages = [];

  if (Array.isArray(eventObj.messages)) {
    eventObj.messages.forEach(m => candidateMessages.push(Object.assign({}, eventObj, { messages: [m] })));
  } else if (eventObj.message) {
    candidateMessages.push(Object.assign({}, eventObj));
  } else if (eventObj.payload && (eventObj.payload.messages || eventObj.payload.message)) {
    if (Array.isArray(eventObj.payload.messages)) {
      eventObj.payload.messages.forEach(m => {
        const merged = { ...eventObj.payload, payload: undefined, message: m, messages: [m], origin: eventObj.origin || 'antigravity' };
        candidateMessages.push(merged);
      });
    } else {
      const merged = { ...eventObj.payload, payload: undefined, message: eventObj.payload.message || eventObj.payload, origin: eventObj.origin || 'antigravity' };
      candidateMessages.push(merged);
    }
  } else {
    candidateMessages.push(eventObj);
  }

  for (const c of candidateMessages) {
    const norm = normalizeMsg(c);
    if (argv.phone_id) {
      const found = (norm.raw && JSON.stringify(norm.raw).includes(argv.phone_id)) || (norm.from && norm.from.includes(argv.phone_id)) || (norm.to && norm.to.includes(argv.phone_id));
      if (!found) continue;
    }

    const fromMs = argv.from ? isoToMs(argv.from) : null;
    const toMs = argv.to ? isoToMs(argv.to) : null;
    if (!withinWindow(norm.timestamp, fromMs, toMs)) {
      continue;
    }

    const res = await insertMessageNormalized(norm);
    accum.total++;
    if (res.status === 'inserted') accum.inserted.push(res.docId);
    else if (res.status === 'exists') accum.exists.push(res.docId);
    else accum.failed.push({ docId: res.docId, error: res.error, raw: norm.raw_parse_error || norm.raw });
  }
}

async function parseLogFile(path, accum) {
  const rl = readline.createInterface({
    input: fs.createReadStream(path),
    crlfDelay: Infinity
  });
  for await (const line of rl) {
    try {
      const jsonStart = line.indexOf('{');
      if (jsonStart >= 0) {
        let jsonText = line.slice(jsonStart);
        try {
          const obj = JSON.parse(jsonText);
          await processLineEvent(obj, accum);
        } catch (e) {
          const last = jsonText.lastIndexOf('}');
          if (last > 0) {
            jsonText = jsonText.slice(0, last + 1);
            try {
              const obj2 = JSON.parse(jsonText);
              await processLineEvent(obj2, accum);
            } catch (e2) {}
          }
        }
      }
    } catch (err) {
      accum.parse_errors.push({ line: line.slice(0, 400), err: err.message });
    }
  }
}

function capturePm2Logs(lines) {
  return new Promise((resolve, reject) => {
    exec(`pm2 logs whatsapp-integration-v6 --lines ${lines} --nostream`, { maxBuffer: 1024 * 1024 * 40 }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

async function fetchAntigravityRouteLogs(routeId, from, to) {
  if (!process.env.ANTIGRAVITY_BASE || !process.env.ANTIGRAVITY_TOKEN) {
    throw new Error('ANTIGRAVITY_BASE and ANTIGRAVITY_TOKEN must be set to fetch Antigravity logs');
  }
  const base = process.env.ANTIGRAVITY_BASE.replace(/\/$/, '');
  const url = `${base}/api/v1/routes/${routeId}/logs?limit=5000&after=${encodeURIComponent(from)}&before=${encodeURIComponent(to)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.ANTIGRAVITY_TOKEN}`, Accept: 'application/json' },
    timeout: 60 * 1000
  });
  if (!res.ok) throw new Error(`Antigravity logs fetch failed ${res.status}`);
  const body = await res.json();
  return body.entries || [];
}

(async function main() {
  console.log('Starting replay_baileys_to_firestore. Dry run:', !!argv.dry_run);
  const report = {
    requested_at: new Date().toISOString(),
    options: argv,
    total: 0,
    inserted: [],
    exists: [],
    failed: [],
    parse_errors: [],
    antigravity_replayed: [],
    antigravity_errors: []
  };

  try {
    if (argv.antigravity && argv.route_id) {
      console.log('Fetching antigravity logs for route:', argv.route_id);
      const from = argv.from || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const to = argv.to || new Date().toISOString();
      const entries = await fetchAntigravityRouteLogs(argv.route_id, from, to);
      for (const e of entries) {
        try {
          await processLineEvent(e, report);
          report.antigravity_replayed.push({ entry_id: e.id || null, status: 'ok' });
        } catch (err) {
          report.antigravity_errors.push({ entry_id: e.id || null, error: err.message });
        }
      }
    }

    if (argv['log-file']) {
      console.log('Parsing log file:', argv['log-file']);
      await parseLogFile(argv['log-file'], report);
    }

    if (argv.pm2) {
      console.log('Capturing pm2 logs...');
      const txt = await capturePm2Logs(argv.lines || 5000);
      const tmp = '/tmp/baileys_pm2_capture.log';
      fs.writeFileSync(tmp, txt);
      await parseLogFile(tmp, report);
      fs.unlinkSync(tmp);
    }

    report.total = report.inserted.length + report.exists.length + report.failed.length;
  } catch (err) {
    report.error = err.message;
    console.error('Fatal error:', err);
  }

  fs.writeFileSync(argv.out, JSON.stringify(report, null, 2), 'utf8');
  console.log('Replay finished. Report saved to', argv.out);
  process.exit(0);
})();
