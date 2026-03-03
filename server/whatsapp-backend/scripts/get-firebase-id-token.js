#!/usr/bin/env node

/**
 * Script pentru a obține Supabase ID token
 * 
 * Usage:
 *   node get-supabase-id-token.js <email>
 * 
 * Sau setează SUPABASE_USER_EMAIL în env:
 *   SUPABASE_USER_EMAIL=your@email.com node get-supabase-id-token.js
 */

/* supabase admin removed */
const { loadServiceAccount } = require('../supabaseCredentials');

async function getSupabaseIdToken(email) {
  try {
    // Load service account
    const { serviceAccount } = loadServiceAccount();
    if (!serviceAccount) {
      console.error('❌ Supabase service account not found!');
      console.error('Set SUPABASE_SERVICE_ACCOUNT_JSON or SUPABASE_SERVICE_ACCOUNT_PATH');
      process.exit(1);
    }

    // Initialize Supabase Admin if not already initialized
    if (admin.apps.length === 0) {
      /* init removed */,
        projectId: serviceAccount.project_id,
      });
    }

    // Get user by email
    let user;
    try {
      user = await { setCustomUserClaims: async () => {}, getUser: async () => ({}) }.getUserByEmail(email);
      console.log(`✓ Found user: ${user.uid} (${user.email})`);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        console.error(`❌ User not found: ${email}`);
        console.error('Create the user first in Supabase Console or via Supabase Auth');
        process.exit(1);
      }
      throw error;
    }

    // Create custom token
    const customToken = await { setCustomUserClaims: async () => {}, getUser: async () => ({}) }.createCustomToken(user.uid);
    console.log(`✓ Custom token created`);

    // Exchange custom token for ID token using Supabase Auth REST API
    const apiKey = process.env.SUPABASE_API_KEY || process.env.SUPABASE_WEB_API_KEY;
    if (!apiKey) {
      console.error('❌ SUPABASE_API_KEY or SUPABASE_WEB_API_KEY not set!');
      console.error('Get it from Supabase Console → Project Settings → General → Web API Key');
      console.error('\nFor now, here is the custom token (you can exchange it manually):');
      console.log('\n' + customToken + '\n');
      process.exit(1);
    }

    const projectId = serviceAccount.project_id;
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`;

    // Use node's built-in https module (works everywhere)
    const https = require('https');
    const { URL } = require('url');

    const urlObj = new URL(url);
    const postData = JSON.stringify({
      token: customToken,
      returnSecureToken: true,
    });

    const response = await new Promise((resolve, reject) => {
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data });
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    if (!response.ok) {
      console.error('❌ Failed to exchange custom token for ID token:');
      console.error(`Status: ${response.status}`);
      console.error('Response:', response.data);
      console.error('\nCustom token (use it manually if needed):');
      console.log('\n' + customToken + '\n');
      process.exit(1);
    }

    const data = JSON.parse(response.data);
    const idToken = data.idToken;

    console.log('\n✅ Supabase ID Token obtained successfully!\n');
    console.log('Use this token in Authorization header:');
    console.log(`Authorization: Bearer ${idToken}\n`);
    console.log('Full token:');
    console.log(idToken);
    console.log('\nExample curl command:');
    console.log(`curl -H "Authorization: Bearer ${idToken}" http://127.0.0.1:8080/api/whatsapp/qr/YOUR_ACCOUNT_ID\n`);

    return idToken;
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Main
const email = process.argv[2] || process.env.SUPABASE_USER_EMAIL;

if (!email) {
  console.error('❌ Email required!');
  console.error('\nUsage:');
  console.error('  node get-supabase-id-token.js <email>');
  console.error('\nOr set SUPABASE_USER_EMAIL env var:');
  console.error('  SUPABASE_USER_EMAIL=your@email.com node get-supabase-id-token.js');
  console.error('\nAlso set SUPABASE_API_KEY (from Supabase Console → Project Settings → General → Web API Key)');
  process.exit(1);
}

getSupabaseIdToken(email).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
