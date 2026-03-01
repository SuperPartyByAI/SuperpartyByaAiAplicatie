#!/usr/bin/env node
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
const yargs = require('yargs');

const argv = yargs
  .option('hours', { type: 'number', default: 24, describe: 'Cât timp în urmă (ore) pentru verificări logs/messages' })
  .option('out', { type: 'string', default: './verify_all_report.json', describe: 'Fișier JSON output' })
  .option('pm2_lines', { type: 'number', default: 5000, describe: 'Câte linii pm2 să captureze' })
  .option('auth_info_dir', { type: 'string', default: '/opt/app/auth_info', describe: 'Path către auth_info' })
  .help()
  .argv;

const svcPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!svcPath || !fs.existsSync(svcPath)) {
  console.error('ERROR: FIREBASE_SERVICE_ACCOUNT_PATH sau GOOGLE_APPLICATION_CREDENTIALS nu e setat sau nu există.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(svcPath)) });
const db = admin.firestore();

const PM2_LOG_FILE_CANDIDATES = [
  path.join(process.env.HOME || '/root', '.pm2', 'logs', 'whatsapp-integration-v6-out.log'),
  '/opt/app/whatsapp-integration-v6/logs/whatsapp-integration-v6-out.log',
  '/home/universparty/.pm2/logs/whatsapp-integration-v6-out-0.log',
  '/home/universparty/.pm2/logs/whatsapp-integration-v6-out.log',
  '/var/log/whatsapp-integration-v6/out.log'
];

function execPromise(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 1024 * 1024 * 50, ...opts }, (err, stdout, stderr) => {
      resolve(stdout);
    });
  });
}

async function getPm2Logs(lines) {
  for (const f of PM2_LOG_FILE_CANDIDATES) {
    try {
      if (fs.existsSync(f)) {
        const txt = fs.readFileSync(f, 'utf8');
        const arr = txt.split('\n');
        const tail = arr.slice(Math.max(0, arr.length - Math.max(lines, 2000)));
        return tail.join('\n');
      }
    } catch (e) {
    }
  }
  try {
    const stdout = await execPromise(`su - universparty -c "pm2 logs whatsapp-integration-v6 --lines ${lines} --nostream"`);
    return stdout;
  } catch (e) {
    return `PM2 logs command failed: ${JSON.stringify(e).slice(0,200)}`;
  }
}

async function fetchAntigravityRoutes() {
  if (!process.env.ANTIGRAVITY_BASE || !process.env.ANTIGRAVITY_TOKEN) return null;
  const base = process.env.ANTIGRAVITY_BASE.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/api/v1/routes?expand=metadata,destination,bindings,stats&limit=1000`, {
      headers: { Authorization: `Bearer ${process.env.ANTIGRAVITY_TOKEN}`, Accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`Antigravity responded ${res.status}`);
    const body = await res.json();
    return body.routes || body;
  } catch (e) {
    return { error: `Antigravity fetch error: ${e.message}` };
  }
}

function isoNowMinusHours(h) {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

async function countMessagesForFilter(filter) {
  try {
    let q = db.collection('messages');
    if (filter.route_id) q = q.where('route_id', '==', filter.route_id);
    if (filter.whatsapp_phone) q = q.where('from', '==', filter.whatsapp_phone).limit(1);
    if (filter.fromIso) {
      try {
        q = q.where('timestamp', '>=', filter.fromIso);
      } catch (e) { }
    }
    if (filter.toIso) {
      try {
        q = q.where('timestamp', '<=', filter.toIso);
      } catch (e) { }
    }
    const snap = await q.limit(10000).get();
    return snap.size;
  } catch (e) {
    return { error: e.message };
  }
}

function findPhoneInLogs(logText, phoneOrId) {
  if (!logText) return [];
  const re = new RegExp(phoneOrId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const lines = logText.split('\n');
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      const sliceStart = Math.max(0, i - 8), sliceEnd = Math.min(lines.length, i + 8);
      found.push({ line: i + 1, context: lines.slice(sliceStart, sliceEnd).join('\n') });
    }
  }
  return found;
}

async function main() {
  const report = {
    generated_at: new Date().toISOString(),
    options: argv,
    accounts: [],
    routes: [],
    pm2_log_sample: null,
    antigravity: null,
    summary: { total_accounts: 0, connected: 0, needs_qr: 0 }
  };

  const fromIso = isoNowMinusHours(argv.hours);
  const toIso = new Date().toISOString();

  let pm2Logs = '';
  try {
    pm2Logs = await getPm2Logs(argv.pm2_lines);
    report.pm2_log_sample = pm2Logs.slice(0, 200000);
  } catch (e) {
    report.pm2_log_error = String(e).slice(0,200);
  }

  try {
    const snap = await db.collection('wa_accounts').get();
    report.summary.total_accounts = snap.size;
    for (const doc of snap.docs) {
      const data = doc.data();
      const phone_id = data.phone_id || doc.id;
      const rec = {
        label: data.name || data.label || null,
        doc_id: doc.id,
        phone_id,
        whatsapp_phone: data.whatsapp_phone || null,
        status: data.status || null,
        created_at: data.created_at || null,
        updated_at: data.updated_at || null,
        auth_info_exists: false,
        auth_info_session_mtime: null,
        pm2_logs_matches: [],
        firestore_message_count_last_hours: null,
        routes: []
      };

      const authPath = path.join(argv.auth_info_dir, phone_id);
      try {
        if (fs.existsSync(authPath)) {
          rec.auth_info_exists = true;
          const sessionFile = path.join(authPath, 'session.json');
          if (fs.existsSync(sessionFile)) {
            const st = fs.statSync(sessionFile);
            rec.auth_info_session_mtime = st.mtime.toISOString();
          } else {
            rec.auth_info_session_mtime = null;
          }
        } else {
          rec.auth_info_exists = false;
        }
      } catch (e) {
        rec.auth_info_exists = false;
      }

      try {
        if (pm2Logs && pm2Logs.length) {
          if (rec.whatsapp_phone) {
            const phoneMatches = findPhoneInLogs(pm2Logs, rec.whatsapp_phone);
            rec.pm2_logs_matches = phoneMatches;
          }
          const idMatches = findPhoneInLogs(pm2Logs, phone_id);
          if (idMatches.length) {
            rec.pm2_logs_matches = rec.pm2_logs_matches.concat(idMatches);
          }
        }
      } catch (e) {
        rec.pm2_logs_error = e.message;
      }

      try {
        const cnt = await countMessagesForFilter({ phone_id, whatsapp_phone: rec.whatsapp_phone, fromIso, toIso });
        rec.firestore_message_count_last_hours = cnt;
      } catch (e) {
        rec.firestore_message_count_last_hours = { error: e.message };
      }

      report.accounts.push(rec);
      if (rec.status === 'connected') report.summary.connected++;
      if (rec.status === 'needs_qr') report.summary.needs_qr++;
    }
  } catch (e) {
    report.accounts_error = e.message;
  }

  try {
    const rSnap = await db.collection('routes').get();
    for (const rdoc of rSnap.docs) {
      const r = rdoc.data();
      const rid = rdoc.id;
      const metadata = r.metadata || {};
      const phone_id = metadata.phone_id || null;
      const rec = {
        route_id: rid,
        name: r.name || null,
        description: r.description || null,
        metadata,
        is_wildcard: r.is_wildcard || false,
        destination: r.destination || null,
        match_rules: r.match_rules || null,
        bindings: r.bindings || null
      };
      if (phone_id) {
        const acc = report.accounts.find(a => a.phone_id === phone_id);
        if (acc) acc.routes.push({ route_id: rid, name: rec.name });
      }
      report.routes.push(rec);
    }
  } catch (e) {
    report.routes_error = e.message;
  }

  try {
    const ag = await fetchAntigravityRoutes();
    report.antigravity = ag;
  } catch (e) {
    report.antigravity = { error: e.message };
  }

  for (const a of report.accounts) {
    a.pm2_hits = (a.pm2_logs_matches || []).length;
    a.pm2_recent_context = (a.pm2_logs_matches || []).slice(0,3);
  }

  fs.writeFileSync(argv.out, JSON.stringify(report, null, 2), 'utf8');
  console.log('Done. Report written to', argv.out);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
