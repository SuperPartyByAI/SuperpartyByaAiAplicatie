const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function testChatWithAI() {
  const functions = require('firebase-functions-test')();
  const chatWithAI = require('./index').chatWithAI;

  const wrapped = functions.wrap(chatWithAI);

  const result = await wrapped({
    data: {
      messages: [{ role: 'user', content: 'Salut' }],
      sessionId: 'test_session_123',
    },
    auth: {
      uid: 'test_uid',
      token: {
        email: 'test@example.com',
      },
    },
  });

  console.log('Result:', JSON.stringify(result, null, 2));
  functions.cleanup();
  process.exit(0);
}

testChatWithAI().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
