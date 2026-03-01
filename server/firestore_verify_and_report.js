#!/usr/bin/env node
const admin = require('firebase-admin');
const fetch = require('node-fetch');
const yargs = require('yargs');
const fs = require('fs');

const argv = yargs
  .option('from', { type: 'string', demandOption: true })
  .option('to', { type: 'string', demandOption: true })
  .option('routes', { type: 'string', describe: 'Comma separated route ids (optional)' })
  .option('phone_ids', { type: 'string', describe: 'Comma separated phone_ids (optional)' })
  .option('out', { type: 'string', default: './verify_report.json' })
  .help()
  .argv;

const svcPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!svcPath || !fs.existsSync(svcPath)) {
  console.error('ERROR: FIREBASE_SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS is required.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(svcPath)) });
const db = admin.firestore();

async function countMessagesFirestore({ route_id, phone_id, from, to }) {
  let q = db.collection('messages');
  if (route_id) q = q.where('route_id', '==', route_id);
  if (phone_id) q = q.where('route_id', '==', `route-${phone_id}`);
  const fromDate = new Date(from);
  const toDate = new Date(to);
  q = q.where('timestamp', '>=', fromDate.toISOString()).where('timestamp', '<=', toDate.toISOString());
  const snap = await q.get();
  return snap.size;
}

async function fetchAntigravityCount(routeId, from, to) {
  if (!process.env.ANTIGRAVITY_BASE || !process.env.ANTIGRAVITY_TOKEN) return null;
  const base = process.env.ANTIGRAVITY_BASE.replace(/\/$/, '');
  const url = `${base}/api/v1/routes/${routeId}/logs/count?after=${encodeURIComponent(from)}&before=${encodeURIComponent(to)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.ANTIGRAVITY_TOKEN}` }});
  if (!res.ok) return null;
  const body = await res.json();
  return body.count || null;
}

(async function main(){
  const from = argv.from;
  const to = argv.to;
  const routes = (argv.routes && argv.routes.split(',').map(s => s.trim()).filter(Boolean)) || [];
  const phone_ids = (argv.phone_ids && argv.phone_ids.split(',').map(s => s.trim()).filter(Boolean)) || [];

  const report = { requested_at: new Date().toISOString(), from, to, entries: [] };

  if (routes.length === 0 && phone_ids.length === 0) {
    const rSnap = await db.collection('routes').limit(200).get();
    rSnap.forEach(doc => routes.push(doc.id));
  }

  for (const r of routes) {
    const entry = { route_id: r, route_count: null, firestore_count: null, issues: [] };
    try {
      const fc = await countMessagesFirestore({ route_id: r, from, to });
      entry.firestore_count = fc;
    } catch (e) {
      entry.issues.push(`firestore_count_error: ${e.message}`);
    }
    try {
      const ac = await fetchAntigravityCount(r, from, to);
      entry.route_count = ac;
      if (ac !== null && entry.firestore_count !== null) {
        if (ac !== entry.firestore_count) {
          entry.issues.push(`count_mismatch route:${ac} vs firestore:${entry.firestore_count}`);
        }
      }
    } catch (e) {
      entry.issues.push(`antigravity_count_error: ${e.message}`);
    }

    try {
      const q = db.collection('messages').where('route_id', '==', r).where('timestamp', '>=', new Date(from).toISOString()).where('timestamp', '<=', new Date(to).toISOString()).limit(50);
      const snap = await q.get();
      entry.sample = [];
      snap.forEach(d => {
        const data = d.data();
        const missing = [];
        ['message_id','conversation_id','from','to','timestamp','direction','fromMe','content','status','origin'].forEach(k => {
          if (data[k] === undefined) missing.push(k);
        });
        entry.sample.push({ docPath: d.ref.path, missing_fields: missing, sample: data });
        if (missing.length) entry.issues.push(`doc ${d.ref.path} missing ${missing.join(',')}`);
      });
    } catch (e) {
      entry.issues.push(`schema_check_error: ${e.message}`);
    }

    report.entries.push(entry);
  }

  fs.writeFileSync(argv.out, JSON.stringify(report, null, 2), 'utf8');
  console.log('Verification report written to', argv.out);
})();
