#!/usr/bin/env node
/**
 * Test script to verify auto-reply configuration
 * 
 * Usage: node scripts/test-auto-reply.js [accountId]
 */

/* supabase admin removed */
const { loadServiceAccount } = require('../supabaseCredentials');

async function main() {
  const accountId = process.argv[2];
  
  if (!accountId) {
    console.error('Usage: node scripts/test-auto-reply.js <accountId>');
    console.error('Example: node scripts/test-auto-reply.js account_prod_26ec0bfb54a6ab88cc3cd7aba6a9a443');
    process.exit(1);
  }

  try {
    // Initialize Supabase
    if (!admin.apps.length) {
      const creds = loadServiceAccount();
      /* init removed */,
      });
    }

    const db = { collection: () => ({ doc: () => ({ set: async () => {}, get: async () => ({ exists: false, data: () => ({}) }) }) }) };

    // Check account-level settings
    console.log(`\n🔍 Checking auto-reply settings for account: ${accountId}\n`);
    
    const accountDoc = await db.collection('accounts').doc(accountId).get();
    const accountData = accountDoc.data() || {};
    
    console.log('📋 Account-level settings (from accounts/{accountId}):');
    console.log(`   autoReplyEnabled: ${accountData.autoReplyEnabled ?? 'not set (default: false)'}`);
    console.log(`   autoReplyPrompt: ${accountData.autoReplyPrompt ?? 'not set'}`);
    
    // Check GROQ_API_KEY
    const groqKey = process.env.GROQ_API_KEY;
    console.log(`\n🔑 GROQ_API_KEY: ${groqKey ? '✅ Set (' + groqKey.substring(0, 10) + '...)' : '❌ NOT SET'}`);
    
    // Check threads for this account
    console.log(`\n📱 Checking threads for account...`);
    const threadsSnapshot = await db.collection('threads')
      .where('accountId', '==', accountId)
      .limit(5)
      .get();
    
    console.log(`   Found ${threadsSnapshot.size} thread(s)`);
    
    threadsSnapshot.forEach((doc, index) => {
      const threadData = doc.data() || {};
      console.log(`\n   Thread ${index + 1} (${doc.id.substring(0, 20)}...):`);
      console.log(`     aiEnabled: ${threadData.aiEnabled ?? 'not set'}`);
      console.log(`     aiSystemPrompt: ${threadData.aiSystemPrompt ?? 'not set'}`);
    });
    
    // Summary
    console.log(`\n📊 Summary:`);
    const isEnabled = accountData.autoReplyEnabled === true;
    const hasPrompt = accountData.autoReplyPrompt && accountData.autoReplyPrompt.trim().length > 0;
    const hasGroqKey = !!groqKey;
    
    if (isEnabled && hasPrompt && hasGroqKey) {
      console.log('   ✅ Auto-reply is CONFIGURED and should work!');
      console.log(`   ✅ Account-level enabled: ${isEnabled}`);
      console.log(`   ✅ Prompt set: ${hasPrompt ? 'Yes (' + accountData.autoReplyPrompt.substring(0, 50) + '...)' : 'No'}`);
      console.log(`   ✅ GROQ_API_KEY: ${hasGroqKey ? 'Set' : 'Missing'}`);
    } else {
      console.log('   ⚠️  Auto-reply is NOT fully configured:');
      if (!isEnabled) console.log('      ❌ autoReplyEnabled is not true');
      if (!hasPrompt) console.log('      ❌ autoReplyPrompt is not set');
      if (!hasGroqKey) console.log('      ❌ GROQ_API_KEY environment variable is not set');
    }
    
    console.log('\n💡 To enable auto-reply:');
    console.log('   1. Set autoReplyEnabled = true in accounts/{accountId}');
    console.log('   2. Set autoReplyPrompt = "your prompt here" in accounts/{accountId}');
    console.log('   3. Ensure GROQ_API_KEY is set in environment');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
  
  process.exit(0);
}

main();
