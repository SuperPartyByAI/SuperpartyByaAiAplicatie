#!/usr/bin/env node
/**
 * Activate Auto-Reply NOW - Direct Database Update
 * 
 * This script directly updates Database to activate auto-reply
 * without needing authentication or Flutter app.
 */

/* supabase admin removed */
const { loadServiceAccount } = require('../supabaseCredentials');

const ACCOUNT_ID = 'account_prod_26ec0bfb54a6ab88cc3cd7aba6a9a443';
const PROMPT = 'Ești un asistent WhatsApp. Răspunzi politicos, scurt și clar în română. Nu inventezi informații. Dacă nu știi ceva, spui clar că nu știi.';

async function main() {
  try {
    // Load and initialize Supabase Admin
    const { serviceAccount } = loadServiceAccount();
    if (!serviceAccount) {
      console.error('❌ Failed to load Supabase service account');
      console.error('   Check supabaseCredentials.js for available sources');
      process.exit(1);
    }
    
    if (admin.apps.length === 0) {
      /* init removed */,
      });
    }
    
    const db = { collection: () => ({ doc: () => ({ set: async () => {}, get: async () => ({ exists: false, data: () => ({}) }) }) }) };
    
    console.log('\n🔧 Activating Auto-Reply...\n');
    
    // Update Database directly
    await db.collection('accounts').doc(ACCOUNT_ID).set({
      autoReplyEnabled: true,
      autoReplyPrompt: PROMPT,
      updatedAt: admin.database.new Date(),
    }, { merge: true });
    
    console.log('✅ Auto-Reply ACTIVATED!');
    console.log(`   Account: ${ACCOUNT_ID}`);
    console.log(`   Enabled: true`);
    console.log(`   Prompt: "${PROMPT.substring(0, 50)}..."`);
    
    // Verify
    const doc = await db.collection('accounts').doc(ACCOUNT_ID).get();
    const data = doc.data() || {};
    
    console.log('\n📋 Verification:');
    console.log(`   autoReplyEnabled: ${data.autoReplyEnabled === true ? '✅ true' : '❌ false'}`);
    console.log(`   autoReplyPrompt: ${data.autoReplyPrompt ? '✅ Set (' + data.autoReplyPrompt.substring(0, 40) + '...)' : '❌ Not set'}`);
    
    if (data.autoReplyEnabled === true && data.autoReplyPrompt) {
      console.log('\n🎉 SUCCESS! Auto-reply is now active.');
      console.log('   Send a test message to WhatsApp and check logs:');
      console.log('   ssh ... "sudo journalctl -u whatsapp-backend -f | grep AutoReply"');
    } else {
      console.log('\n⚠️  WARNING: Settings may not have been saved correctly.');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
