#!/usr/bin/env node

/**
 * Setup Force Update with Service Account Credentials
 *
 * Usage: node setup-with-credentials.js path/to/credentials.json
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const config = {
  force_update: true,
  min_build_number: 22,
  latest_version: '1.2.2',
  latest_build_number: 22,
  android_download_url: 'https://play.google.com/store/apps/details?id=com.superparty.app',
  release_notes:
    'AI Chat îmbunătățit\nRăspunsuri mai rapide\nFuncții noi în GM mode\nBug fixes și îmbunătățiri',
  update_message: 'O versiune nouă este disponibilă! Trebuie să actualizezi pentru a continua.',
};

async function main() {
  try {
    console.log('🔧 Setting up Force Update configuration...');
    console.log('');

    // Get credentials path from argument or environment
    const credentialsPath = process.argv[2] || process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (!credentialsPath) {
      console.error('❌ No credentials provided!');
      console.log('');
      console.log('Usage:');
      console.log('  node setup-with-credentials.js path/to/credentials.json');
      console.log('');
      console.log('OR set environment variable:');
      console.log(
        '  GOOGLE_APPLICATION_CREDENTIALS=path/to/credentials.json node setup-with-credentials.js'
      );
      process.exit(1);
    }

    if (!fs.existsSync(credentialsPath)) {
      console.error(`❌ Credentials file not found: ${credentialsPath}`);
      process.exit(1);
    }

    console.log(`📁 Loading credentials from: ${credentialsPath}`);
    const serviceAccount = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

    console.log(`📍 Project: ${serviceAccount.project_id}`);
    console.log('');

    // Initialize Firebase Admin
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
    }

    const db = admin.firestore();

    console.log('📝 Creating Firestore document: app_config/version');
    await db.collection('app_config').doc('version').set(config);

    console.log('');
    console.log('✅ Force Update configuration created successfully!');
    console.log('');
    console.log('📋 Configuration:');
    console.log(`   - Force Update: ${config.force_update}`);
    console.log(`   - Min Build Number: ${config.min_build_number}`);
    console.log(`   - Latest Version: ${config.latest_version} (${config.latest_build_number})`);
    console.log(`   - Download URL: ${config.android_download_url}`);
    console.log('');
    console.log('🎯 Users with build < 22 will be forced to update!');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

main();
