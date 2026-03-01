const { processBaileysMessage, initFirebase } = require('../firestore-sync');

// Ensure firebase is initialized (safe to call multiple times with singleton check)
initFirebase();

async function handleMessageUpsert(accountId, { messages, type }) {
  // Only process if type is notify (live messages) or if we want to process all
  // The user prompt said: "history sync + mesaje live"
  // history syncs come as separate protocol messages usually, OR as a burst of messages with type 'append'?
  // Baileys 'notify' is usually live. 'append' is history.
  // We can process all. 

  // Loop through messages
  for (const msg of messages) {
      try {
          // Pass accountId context
          await processBaileysMessage(msg, { 
              downloadMedia: true, 
              accountId: accountId 
          });
      } catch (err) {
          console.error('Error processing message in handleMessageUpsert:', err);
      }
  }
}

module.exports = { handleMessageUpsert };
