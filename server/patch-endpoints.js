/**
 * patch-endpoints.js
 * Patches index.js on VPS to:
 * - Add ADMIN_TOKEN middleware for pairing/admin endpoints
 * - Enhance /status with sessionsById + summary
 * - Replace /api/accounts/:id/qr with qrSeq, qrUpdatedAt, Cache-Control
 * - Rewrite /pair page (accountId param, JS polling, no auto-POST, no auto-refresh)
 * - Update /api/accounts/:id/regenerate-qr to pass reqId, ip, ua, force
 * - Add POST /api/admin/regenerate-all for bulk reconnect
 * - Add rate limiting on regenerate
 * - mkdir -p public/media + chmod 700 auth_info at boot
 * - Guard Google Sync spam when SPREADSHEET_ID not set
 *
 * Usage: node patch-endpoints.js
 * (Run from /root/whatsapp-integration-v6)
 */
import fs from 'fs';
import path from 'path';

const INDEX_PATH = path.join(process.cwd(), 'index.js');
let code = fs.readFileSync(INDEX_PATH, 'utf-8');

// Backup
const backupPath = `${INDEX_PATH}.backup-${Date.now()}`;
fs.writeFileSync(backupPath, code);
console.log(`Backup saved to ${backupPath}`);

// ─── 1. Add boot-time safety: mkdir + chmod ───────────────────────
// Find the line after app.listen or server startup
const bootGuard = `
// ─── Boot Safety ───────────────────────────
import { execSync } from 'child_process';
try { fs.mkdirSync(path.join(process.cwd(), 'public', 'media'), { recursive: true }); } catch {}
try { execSync('chmod 700 ' + path.join(process.cwd(), 'auth_info')); } catch {}
`;

// Insert boot guard after imports (find last import line)
const lastImportIdx = code.lastIndexOf('\nimport ');
if (lastImportIdx > 0) {
  const endOfImportLine = code.indexOf('\n', lastImportIdx + 1);
  // Only add if not already present
  if (!code.includes('Boot Safety')) {
    code = code.slice(0, endOfImportLine + 1) + bootGuard + code.slice(endOfImportLine + 1);
    console.log('✅ Boot Safety guard added');
  }
}

// ─── 2. Add ADMIN_TOKEN middleware ────────────────────────────────
const adminMiddleware = `
// ─── Admin Token Middleware ────────────────
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'superparty-admin-2026';
function requireAdminToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ') || auth.split('Bearer ')[1] !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid admin token' });
  }
  next();
}

// ─── Rate Limiter for regenerate ───────────
const _regenRateLimit = new Map(); // ip -> { count, windowStart }
function regenRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const WINDOW_MS = 60_000; // 1 minute window
  const MAX_PER_WINDOW = 10;

  let entry = _regenRateLimit.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    _regenRateLimit.set(ip, entry);
  }
  entry.count++;
  if (entry.count > MAX_PER_WINDOW) {
    return res.status(429).json({ error: 'rate_limited', message: 'Too many regenerate requests. Wait 60s.', retryAfterMs: WINDOW_MS - (now - entry.windowStart) });
  }
  next();
}
`;

if (!code.includes('requireAdminToken')) {
  // Insert before the first app.get or app.post
  const firstAppUse = code.indexOf("app.use('/media'");
  if (firstAppUse > 0) {
    code = code.slice(0, firstAppUse) + adminMiddleware + '\n' + code.slice(firstAppUse);
    console.log('✅ Admin Token Middleware added');
  }
}

// ─── 3. Replace /status endpoint ─────────────────────────────────
const oldStatus = code.match(/app\.get\("\/status"[\s\S]*?\}\);/m);
if (oldStatus) {
  const newStatus = `app.get("/status", (req, res) => {
  const sessions = [];
  const sessionsById = {};
  const summary = { connected: 0, needs_qr: 0, qr_ready: 0, regenerating: 0, reconnecting: 0, disconnected: 0, other: 0 };

  if (sessionManager && sessionManager.sessions) {
    sessionManager.sessions.forEach((val, key) => {
      const rstate = sessionManager._regeneratingState?.get(key);
      const entry = {
        docId: key,
        status: val.status,
        qr: !!val.qr,
        qrSeq: val.qrSeq || 0,
        qrUpdatedAt: val.qrUpdatedAt || null,
        phone: val.sock?.user?.id?.split(':')[0] || null,
        label: val.label || '',
        reconnectAttempts: val.reconnectAttempts || 0,
        pairingPhase: rstate?.phase || null,
        pairingStartedAt: rstate?.startedAt ? new Date(rstate.startedAt).toISOString() : null,
        reqId: val.reqId || rstate?.reqId || null,
        requiresQR: !val.sock && val.status === 'needs_qr',
      };
      sessions.push(entry);
      sessionsById[key] = entry;

      // Summary counts
      if (val.status === 'connected') summary.connected++;
      else if (val.status === 'needs_qr') summary.needs_qr++;
      else if (val.status === 'reconnecting') summary.reconnecting++;
      else if (val.status === 'disconnected') summary.disconnected++;
      else summary.other++;
      if (rstate) {
        if (rstate.phase === 'qr_ready') summary.qr_ready++;
        else if (rstate.phase === 'regenerating') summary.regenerating++;
      }
    });
  }

  res.json({
    status: "ok",
    mode: "multi-session",
    sessions,
    sessionsById,
    summary,
    metrics: sessionManager.metrics || {}
  });
});`;
  code = code.replace(oldStatus[0], newStatus);
  console.log('✅ /status endpoint replaced');
}

// ─── 4. Replace /api/accounts/:id/qr endpoint ────────────────────
const oldQr = code.match(/app\.get\('\/api\/accounts\/:id\/qr'[\s\S]*?\}\);/m);
if (oldQr) {
  const newQr = `app.get('/api/accounts/:id/qr', requireAdminToken, (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  const docId = req.params.id;
  const s = sessionManager.sessions.get(docId);
  const rstate = sessionManager._regeneratingState?.get(docId);
  if (!s) return res.status(404).json({ error: 'Session not found', docId });
  res.json({
    docId,
    status: s.status,
    qr: s.qr || null,
    qrSeq: s.qrSeq || 0,
    qrUpdatedAt: s.qrUpdatedAt || null,
    state: rstate?.phase || (s.status === 'connected' ? 'connected' : 'idle'),
    reqId: s.reqId || rstate?.reqId || null,
  });
});`;
  code = code.replace(oldQr[0], newQr);
  console.log('✅ /api/accounts/:id/qr endpoint replaced');
}

// ─── 5. Replace /pair page ────────────────────────────────────────
const oldPair = code.match(/app\.get\("\/pair"[\s\S]*?^\}\);/m);
if (oldPair) {
  const newPair = `app.get("/pair", requireAdminToken, (req, res) => {
  const accountId = req.query.accountId || '';
  const token = req.headers.authorization?.split('Bearer ')[1] || req.query.token || '';

  res.set('Cache-Control', 'no-store');
  res.send(\`<!DOCTYPE html>
<html><head>
  <title>WhatsApp QR Pairing</title>
  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
  <style>
    body { font-family: -apple-system, sans-serif; padding: 20px; background: #1a1a2e; color: #eee; }
    h1 { color: #e94560; }
    .card { border: 1px solid #333; padding: 20px; margin: 10px; border-radius: 12px; display: inline-block; vertical-align: top; width: 340px; background: #16213e; }
    .status { padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: bold; display: inline-block; }
    .status-connected { background: #2ecc71; color: #000; }
    .status-needs_qr { background: #e67e22; color: #fff; }
    .status-reconnecting { background: #3498db; color: #fff; }
    .status-regenerating { background: #9b59b6; color: #fff; }
    .btn { padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; margin: 5px; }
    .btn-regen { background: #e94560; color: #fff; }
    .btn-regen:disabled { background: #555; cursor: not-allowed; }
    #accounts-list { margin-top: 20px; }
    .qr-container canvas { border-radius: 8px; }
    .seq { font-size: 12px; color: #888; margin-top: 5px; }
    select { padding: 8px; border-radius: 8px; background: #16213e; color: #eee; border: 1px solid #333; }
  </style>
</head>
<body>
  <h1>🔗 WhatsApp QR Pairing</h1>
  <p>Select an account, click Regenerate, then scan with WhatsApp → Linked Devices.</p>
  <div>
    <label>Account: </label>
    <select id="accountSelect"></select>
    <button class="btn btn-regen" id="regenBtn" onclick="doRegenerate()">🔄 Regenerate QR</button>
  </div>
  <div id="qr-display" style="margin-top:20px;"></div>
  <div id="status-display" style="margin-top:10px;"></div>
  <div id="all-accounts" style="margin-top:30px;"></div>

  <script>
    const TOKEN = '\${token}';
    const BASE = window.location.origin;
    const headers = TOKEN ? { 'Authorization': 'Bearer ' + TOKEN } : {};
    let selectedAccount = '\${accountId}';
    let currentQrSeq = 0;
    let polling = null;

    async function loadAccounts() {
      try {
        const r = await fetch(BASE + '/status');
        const d = await r.json();
        const sel = document.getElementById('accountSelect');
        sel.innerHTML = '<option value="">-- select --</option>';
        d.sessions.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.docId;
          opt.textContent = s.docId.substring(0,8) + '... [' + s.status + '] ' + (s.phone || '');
          if (s.docId === selectedAccount) opt.selected = true;
          sel.appendChild(opt);
        });

        // Show summary
        const sum = d.summary || {};
        document.getElementById('all-accounts').innerHTML =
          '<h3>All Accounts</h3>' +
          '<p>🟢 Connected: ' + (sum.connected||0) +
          ' | 🟡 Needs QR: ' + (sum.needs_qr||0) +
          ' | 🔵 Reconnecting: ' + (sum.reconnecting||0) +
          ' | 🔴 Disconnected: ' + (sum.disconnected||0) + '</p>';
      } catch(e) { console.error('loadAccounts error:', e); }
    }

    async function doRegenerate() {
      const acct = document.getElementById('accountSelect').value;
      if (!acct) return alert('Select an account first');
      selectedAccount = acct;
      const btn = document.getElementById('regenBtn');
      btn.disabled = true;
      btn.textContent = '⏳ Regenerating...';
      try {
        const r = await fetch(BASE + '/api/accounts/' + acct + '/regenerate-qr', {
          method: 'POST', headers
        });
        const d = await r.json();
        document.getElementById('status-display').innerHTML =
          '<pre>' + JSON.stringify(d, null, 2) + '</pre>';
        if (d.status === 'regenerating' || d.status === 'already_regenerating' || d.status === 'cooldown') {
          startPolling(acct);
        }
      } catch(e) {
        document.getElementById('status-display').innerHTML = '<p style="color:red">Error: ' + e.message + '</p>';
      }
      setTimeout(() => { btn.disabled = false; btn.textContent = '🔄 Regenerate QR'; }, 10000);
    }

    function startPolling(acct) {
      if (polling) clearInterval(polling);
      currentQrSeq = 0;
      polling = setInterval(async () => {
        try {
          const r = await fetch(BASE + '/api/accounts/' + acct + '/qr', { headers });
          if (!r.ok) return;
          const d = await r.json();
          if (d.qr && d.qrSeq !== currentQrSeq) {
            currentQrSeq = d.qrSeq;
            const container = document.getElementById('qr-display');
            container.innerHTML = '<div class="qr-container"></div>';
            QRCode.toCanvas(document.createElement('canvas'), d.qr, {width: 300, margin: 2}, (err, canvas) => {
              if (!err) container.querySelector('.qr-container').appendChild(canvas);
            });
            container.innerHTML += '<p class="seq">QR #' + d.qrSeq + ' | State: ' + d.state + ' | Updated: ' + (d.qrUpdatedAt || 'now') + '</p>';
          }
          document.getElementById('status-display').innerHTML =
            '<p>Status: <span class="status status-' + d.status + '">' + d.status + '</span> | Phase: ' + (d.state||'idle') + '</p>';
          if (d.status === 'connected') {
            clearInterval(polling);
            document.getElementById('qr-display').innerHTML = '<h2 style="color:#2ecc71">✅ CONNECTED!</h2>';
            loadAccounts();
          }
        } catch(e) { console.error('poll error:', e); }
      }, 2000);
    }

    document.getElementById('accountSelect').addEventListener('change', (e) => {
      selectedAccount = e.target.value;
      if (selectedAccount) startPolling(selectedAccount);
    });

    loadAccounts();
    if (selectedAccount) startPolling(selectedAccount);
  </script>
</body></html>\`);
});`;
  code = code.replace(oldPair[0], newPair);
  console.log('✅ /pair page replaced');
}

// ─── 6. Replace /api/accounts/:id/regenerate-qr ──────────────────
const oldRegen = code.match(/app\.post\("\/api\/accounts\/:id\/regenerate-qr"[\s\S]*?^\}\);/m);
if (oldRegen) {
  const newRegen = `app.post("/api/accounts/:id/regenerate-qr", requireAdminToken, regenRateLimit, async (req, res) => {
  const docId = req.params.id;
  const force = req.query.force === 'true';
  const ip = req.ip || req.connection.remoteAddress || '?';
  const ua = (req.headers['user-agent'] || '').substring(0, 60);
  console.log(\`[HTTP] POST /regenerate-qr docId=\${docId} force=\${force} ip=\${ip} ua=\${ua}\`);
  try {
    const result = await sessionManager.regenerateQR(docId, { force, ip, ua });
    const httpCode = result.status === 'cooldown' ? 429 : 200;
    res.status(httpCode).json({ ok: true, ...result });
  } catch (e) {
    console.error("[regenerate-qr] Error:", e);
    res.status(500).json({ error: e.message });
  }
});`;
  code = code.replace(oldRegen[0], newRegen);
  console.log('✅ /api/accounts/:id/regenerate-qr endpoint replaced');
}

// ─── 7. Add POST /api/admin/regenerate-all ────────────────────────
if (!code.includes('regenerate-all')) {
  const bulkEndpoint = `

// POST /api/admin/regenerate-all - Bulk regenerate with concurrency control
app.post("/api/admin/regenerate-all", requireAdminToken, async (req, res) => {
  const concurrency = Math.min(parseInt(req.query.concurrency) || 2, 5);
  const results = [];
  const accountsToRegenerate = [];

  // Collect accounts that need QR
  sessionManager.sessions.forEach((val, key) => {
    if (val.status === 'needs_qr' || val.status === 'disconnected') {
      accountsToRegenerate.push(key);
    }
  });

  // Also check Database for accounts not in sessions map
  try {
    const snap = await db.collection('wa_accounts').where('status', 'in', ['needs_qr', 'disconnected', 'logged_out']).get();
    snap.forEach(doc => {
      if (!accountsToRegenerate.includes(doc.id)) {
        accountsToRegenerate.push(doc.id);
      }
    });
  } catch (e) {
    console.error('[regenerate-all] Database query error:', e.message);
  }

  console.log(\`[Admin] regenerate-all: \${accountsToRegenerate.length} accounts, concurrency=\${concurrency}\`);

  // Process in batches
  for (let i = 0; i < accountsToRegenerate.length; i += concurrency) {
    const batch = accountsToRegenerate.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(async (docId) => {
        try {
          const result = await sessionManager.regenerateQR(docId, {
            ip: req.ip || '?',
            ua: 'admin-bulk'
          });
          return { docId, ...result };
        } catch (e) {
          return { docId, status: 'error', error: e.message };
        }
      })
    );
    for (const r of batchResults) {
      results.push(r.status === 'fulfilled' ? r.value : { docId: '?', status: 'error', error: r.reason?.message });
    }
    // Delay between batches to avoid throttling
    if (i + concurrency < accountsToRegenerate.length) {
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  res.json({
    ok: true,
    total: accountsToRegenerate.length,
    results,
    summary: {
      regenerating: results.filter(r => r.status === 'regenerating').length,
      already_regenerating: results.filter(r => r.status === 'already_regenerating').length,
      cooldown: results.filter(r => r.status === 'cooldown').length,
      error: results.filter(r => r.status === 'error').length,
    }
  });
});
`;

  // Insert before the verifySupabaseToken function
  const insertPoint = code.indexOf('/* ===== SECURE AUTH MIDDLEWARE');
  if (insertPoint > 0) {
    code = code.slice(0, insertPoint) + bulkEndpoint + '\n' + code.slice(insertPoint);
    console.log('✅ POST /api/admin/regenerate-all added');
  }
}

// ─── 8. Write the patched file ────────────────────────────────────
fs.writeFileSync(INDEX_PATH, code);
console.log(`\n✅ All patches applied to ${INDEX_PATH}`);
console.log('Run: pm2 restart whatsapp-integration-v6');
