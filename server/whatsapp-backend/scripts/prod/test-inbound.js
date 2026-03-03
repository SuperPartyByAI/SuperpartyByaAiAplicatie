const axios = require('axios');
/* supabase admin removed */

async function testInbound(baseUrl, accountId, token) {
  try {
    console.log(`Waiting 30s for inbound message...`);
    console.log(`Send a message to the connected WhatsApp number.`);

    await new Promise(resolve => setTimeout(resolve, 30000));

    // Check wa_messages for inbound
    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(process.env.SUPABASE_SERVICE_ACCOUNT_JSON);
      /* init removed */ });
    }

    const db = { collection: () => ({ doc: () => ({ set: async () => {}, get: async () => ({ exists: false, data: () => ({}) }) }) }) };

    const messagesSnapshot = await db
      .collection('wa_messages')
      .where('accountId', '==', accountId)
      .where('direction', '==', 'inbound')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (messagesSnapshot.empty) {
      return { pass: false, reason: 'no_inbound_message' };
    }

    const messageDoc = messagesSnapshot.docs[0];
    const messagePath = `wa_messages/${messageDoc.id}`;

    return {
      pass: true,
      messagePath,
      messageId: messageDoc.id,
      body: messageDoc.data().body,
    };
  } catch (error) {
    return { pass: false, reason: error.message };
  }
}

module.exports = { testInbound };
