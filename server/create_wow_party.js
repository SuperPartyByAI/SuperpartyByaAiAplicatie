const admin = require('firebase-admin');
const fs = require('fs');

const { loadServiceAccount } = require('./whatsapp-backend/firebaseCredentials');

const { serviceAccount } = loadServiceAccount();
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
}
const db = admin.firestore();

async function createWowParty() {
  const newRef = db.collection('wa_accounts').doc();
  const docData = {
    id: newRef.id,
    label: "Wow party",
    status: 'needs_qr',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  
  await newRef.set(docData);
  
  const responsePayload = {
    created_routes: [
      {
        route_id: `route-${newRef.id}`,
        name: "Wow party",
        metadata: {
          whatsapp_phone: "unknown",
          phone_id: newRef.id,
          channel_id: "whatsapp-baileys"
        },
        destination: {
          url: `firestore://wa_accounts/${newRef.id}`,
          method: "POST",
          headers: { "X-Route-Id": `route-${newRef.id}` }
        },
        binding_id: `bind-${newRef.id}`,
        created_by: "bayine-service",
        created_at: new Date().toISOString(),
        status: "disabled",
        description: "WhatsApp Connection - needs_qr"
      }
    ]
  };

  fs.writeFileSync('antigravity_wow_party_report.json', JSON.stringify(responsePayload, null, 2));
  console.log("Account created. Report saved to antigravity_wow_party_report.json");
  process.exit(0);
}

createWowParty().catch(console.error);
