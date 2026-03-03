#!/usr/bin/env node

/**
 * Script de migrare: Update displayName pentru toate thread-urile cu LID
 * 
 * Usage:
 *   node scripts/migrate-lid-contacts.js [--dry-run] [--account=ACCOUNT_ID]
 * 
 * Options:
 *   --dry-run     : Nu face update-uri, doar afișează ce ar face
 *   --account=ID  : Procesează doar un anumit account
 */

/* supabase admin removed */
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const specificAccount = args.find(arg => arg.startsWith('--account='))?.split('=')[1];

console.log('🚀 LID Contact Migration Script');
console.log('================================');
console.log(`Mode: ${DRY_RUN ? '🧪 DRY RUN (no changes)' : '✍️  WRITE MODE'}`);
if (specificAccount) {
  console.log(`Account filter: ${specificAccount}`);
}
console.log('');

// Initialize Supabase Admin
let serviceAccountJson;
if (process.env.SUPABASE_SERVICE_ACCOUNT_JSON) {
  try {
    serviceAccountJson = JSON.parse(process.env.SUPABASE_SERVICE_ACCOUNT_JSON);
    console.log('✅ Using SUPABASE_SERVICE_ACCOUNT_JSON from environment');
  } catch (e) {
    console.error('❌ Failed to parse SUPABASE_SERVICE_ACCOUNT_JSON:', e.message);
    process.exit(1);
  }
} else {
  // Try to load from file
  const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');
  if (fs.existsSync(serviceAccountPath)) {
    serviceAccountJson = require(serviceAccountPath);
    console.log('✅ Using serviceAccountKey.json from file');
  } else {
    console.error('❌ No Supabase credentials found. Set SUPABASE_SERVICE_ACCOUNT_JSON or provide serviceAccountKey.json');
    process.exit(1);
  }
}

if (!admin.apps.length) {
  /* init removed */,
  });
}

const db = { collection: () => ({ doc: () => ({ set: async () => {}, get: async () => ({ exists: false, data: () => ({}) }) }) }) };

// Load account data and sockets
const accounts = new Map(); // accountId -> { sock, status, ... }

async function loadAccounts() {
  try {
    console.log('📥 Loading accounts from Database...');
    const accountsSnapshot = await db.collection('whatsappAccounts').get();
    
    let loaded = 0;
    for (const doc of accountsSnapshot.docs) {
      const accountId = doc.id;
      const data = doc.data();
      
      if (specificAccount && accountId !== specificAccount) {
        continue; // Skip if filtering by account
      }
      
      if (data.status === 'connected') {
        accounts.set(accountId, {
          accountId,
          status: data.status,
          phoneNumber: data.phoneNumber || 'unknown',
        });
        loaded++;
      }
    }
    
    console.log(`✅ Loaded ${loaded} connected accounts`);
    return loaded > 0;
  } catch (error) {
    console.error('❌ Error loading accounts:', error.message);
    return false;
  }
}

async function fetchContactInfo(jid) {
  // Since we don't have access to the sock object here, we'll use a different approach
  // We'll check if the thread has received any messages with pushName
  // Or we can make an API call to the Hetzner backend if needed
  
  // For now, return null - the real fix will happen when new messages arrive
  // This script will primarily mark threads that need updating
  return null;
}

async function migrateThreads() {
  try {
    console.log('');
    console.log('🔍 Scanning threads...');
    
    const threadsRef = db.collection('threads');
    const snapshot = await threadsRef.get();
    
    console.log(`Found ${snapshot.size} total threads`);
    console.log('');
    
    let processed = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const doc of snapshot.docs) {
      const threadId = doc.id;
      const data = doc.data();
      const clientJid = data.clientJid;
      const accountId = data.accountId;
      
      // Filter by account if specified
      if (specificAccount && accountId !== specificAccount) {
        continue;
      }
      
      // Skip if not a LID
      if (!clientJid || !clientJid.endsWith('@lid')) {
        continue;
      }
      
      processed++;
      
      // Check if displayName is missing or empty
      const hasDisplayName = data.displayName && data.displayName.trim().length > 0;
      
      console.log(`[${processed}] Thread: ${threadId}`);
      console.log(`    clientJid: ${clientJid}`);
      console.log(`    accountId: ${accountId}`);
      console.log(`    displayName: ${data.displayName || '(empty)'}`);
      
      if (hasDisplayName) {
        console.log(`    ✓ Already has displayName, skipping`);
        skipped++;
        console.log('');
        continue;
      }
      
      // Try to get the last message to check for pushName
      try {
        const messagesSnapshot = await db
          .collection('threads')
          .doc(threadId)
          .collection('messages')
          .orderBy('tsClient', 'desc')
          .limit(10)
          .get();
        
        let foundPushName = null;
        for (const msgDoc of messagesSnapshot.docs) {
          const msgData = msgDoc.data();
          if (msgData.pushName && msgData.pushName.trim().length > 0) {
            foundPushName = msgData.pushName;
            break;
          }
        }
        
        if (foundPushName) {
          console.log(`    📝 Found pushName in messages: ${foundPushName}`);
          
          if (!DRY_RUN) {
            await threadsRef.doc(threadId).update({
              displayName: foundPushName,
            });
            console.log(`    ✅ Updated displayName to: ${foundPushName}`);
            updated++;
          } else {
            console.log(`    🧪 DRY RUN: Would update displayName to: ${foundPushName}`);
            updated++;
          }
        } else {
          console.log(`    ⚠️  No pushName found in recent messages`);
          console.log(`    💡 Will be updated when next message arrives`);
          skipped++;
        }
      } catch (error) {
        console.error(`    ❌ Error processing thread: ${error.message}`);
        errors++;
      }
      
      console.log('');
    }
    
    console.log('================================');
    console.log('📊 MIGRATION SUMMARY');
    console.log('================================');
    console.log(`Total LID threads processed: ${processed}`);
    console.log(`✅ Updated: ${updated}`);
    console.log(`⏭️  Skipped (already have name): ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log('');
    
    if (DRY_RUN) {
      console.log('🧪 DRY RUN completed - no changes were made');
      console.log('💡 Run without --dry-run to apply changes');
    } else {
      console.log('✅ Migration completed!');
    }
    
  } catch (error) {
    console.error('❌ Migration error:', error);
    throw error;
  }
}

async function main() {
  try {
    await loadAccounts();
    await migrateThreads();
    process.exit(0);
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  }
}

main();
