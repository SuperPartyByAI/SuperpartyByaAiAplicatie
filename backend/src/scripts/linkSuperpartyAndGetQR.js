// linkSuperpartyAndGetQR.js
// Run with: node linkSuperpartyAndGetQR.js <TOKEN> [label]
// <TOKEN> – ID token / auth header for requireApprovedEmployee middleware
// [label] – optional label (default "Superparty")

const https = require('https');
const http = require('http');
const querystring = require('querystring');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001'; // adjust if needed

function request(options, body) {
  return new Promise((resolve, reject) => {
    const lib = options.protocol === 'https:' ? https : http;
    const req = lib.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, json });
        } catch (_) {
          resolve({ status: res.statusCode, json: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const [,, token, labelArg] = process.argv;
  if (!token) {
    console.error('Usage: node linkSuperpartyAndGetQR.js <TOKEN> [label]');
    process.exit(1);
  }
  const label = labelArg || 'Superparty';
  const postOptions = {
    protocol: BASE_URL.startsWith('https') ? 'https:' : 'http:',
    hostname: BASE_URL.replace(/^https?:\/\//, ''),
    port: BASE_URL.includes(':') ? BASE_URL.split(':')[2] : (BASE_URL.startsWith('https') ? 443 : 80),
    path: '/api/wa-accounts/link-superparty',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };

  console.log('Creating / linking Superparty account...');
  const { status, json } = await request(postOptions, JSON.stringify({ label }));
  if (status !== 200 && status !== 201) {
    console.error('Failed to create account:', status, json);
    process.exit(1);
  }
  const accountId = json.accountId;
  console.log('Account ID:', accountId);

  // Poll for QR code (max 30 attempts, 2s interval)
  const getOptions = (id) => ({
    protocol: BASE_URL.startsWith('https') ? 'https:' : 'http:',
    hostname: BASE_URL.replace(/^https?:\/\//, ''),
    port: BASE_URL.includes(':') ? BASE_URL.split(':')[2] : (BASE_URL.startsWith('https') ? 443 : 80),
    path: `/api/wa-accounts/${id}/qr`,
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  console.log('Waiting for QR code...');
  for (let i = 0; i < 30; i++) {
    const { status: s, json: j } = await request(getOptions(accountId));
    if (s === 200 && j.qr) {
      console.log('✅ QR code ready!');
      console.log('QR string (paste into WhatsApp > Linked Devices > Scan QR):');
      console.log(j.qr);
      process.exit(0);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.error('Timed out waiting for QR code. Check server logs.');
  process.exit(1);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
