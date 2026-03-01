// patch_pair_page.js — Run on VPS to patch index.js with visual QR codes
import fs from 'fs';

const file = '/root/whatsapp-integration-v6/index.js';
let content = fs.readFileSync(file, 'utf8');

// 1. Add QR data endpoint before the pairing UI
const pairMarker = '// --- Pairing UI ---';
const qrEndpoint = `
// GET /api/accounts/:id/qr - Get raw QR code data
app.get('/api/accounts/:id/qr', (req, res) => {
  const s = sessionManager.sessions.get(req.params.id);
  if (!s || !s.qr) return res.status(404).json({ error: 'No QR available' });
  res.json({ qr: s.qr });
});

`;
if (!content.includes('/api/accounts/:id/qr')) {
  content = content.replace(pairMarker, qrEndpoint + pairMarker);
  console.log('Added /api/accounts/:id/qr endpoint');
}

// 2. Replace entire /pair route with one that renders visual QR codes
const pairRouteStart = `app.get("/pair", (req, res) => {`;
const pairRouteEnd = `});

// --- Helper: normalize timestamp extraction`;

const oldPairBlock = content.substring(
  content.indexOf(pairRouteStart),
  content.indexOf(pairRouteEnd)
);

const newPairRoute = `app.get("/pair", (req, res) => {
  const sessions = [];
  sessionManager.sessions.forEach((val, key) => {
    sessions.push({ docId: key, status: val.status, qr: val.qr || null, phone: val.sock?.user?.id?.split(':')[0] || '' });
  });
  
  const cards = sessions.map(s => {
    const qrScript = s.qr ? 
      \`<div id="qr-\${s.docId}" style="margin:10px 0"></div>
       <script>
         QRCode.toCanvas(document.createElement('canvas'), "\${s.qr}", {width:280}, function(err, canvas) {
           if(!err) document.getElementById('qr-\${s.docId}').appendChild(canvas);
         });
       </script>\` : '';
    return \`<div style="border:1px solid #ccc;padding:15px;margin:10px;border-radius:8px;display:inline-block;vertical-align:top;width:320px">
      <h3>\${s.docId.substring(0,8)}...</h3>
      <p>Status: <b style="color:\${s.status==='connected'?'green':s.status==='needs_qr'?'orange':'gray'}">\${s.status}</b></p>
      \${s.phone ? \`<p>📱 \${s.phone}</p>\` : ''}
      \${qrScript}
      \${!s.qr && s.status==='needs_qr' ? '<p style="color:red">⚠️ QR expired — <a href="javascript:fetch(\\'/api/accounts/'+s.docId+'/regenerate-qr\\',{method:\\' POST\\'}).then(()=>location.reload())">Regenerate</a></p>' : ''}
    </div>\`;
  }).join('');

  res.send(\`<html>
    <head>
      <title>WhatsApp Multi-Pairing</title>
      <meta http-equiv="refresh" content="10">
      <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
      <style>body{font-family:sans-serif;padding:20px;background:#f5f5f5}</style>
    </head>
    <body>
      <h1>🔗 WhatsApp QR Pairing</h1>
      <p>Scan these QR codes with WhatsApp → Linked Devices → Link a Device</p>
      <div>\${cards}</div>
    </body>
  </html>\`);
`;

content = content.replace(oldPairBlock, newPairRoute);
console.log('Replaced /pair route with visual QR renderer');

fs.writeFileSync(file, content);
console.log('Patch applied successfully!');
