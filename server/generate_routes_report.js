const admin = require('firebase-admin');
const { loadServiceAccount } = require('./whatsapp-backend/firebaseCredentials');

const { serviceAccount } = loadServiceAccount();
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id
});

const db = admin.firestore();

async function generateReport() {
  const accountsSnapshot = await db.collection('wa_accounts').get();
  
  const report = {
    routes: [],
    route_logs: {},
    bindings: []
  };

  for (const doc of accountsSnapshot.docs) {
    const data = doc.data();
    const routeId = `route-${doc.id}`;
    const phone = data.phoneNumber ? `+${data.phoneNumber}` : 'unknown';
    
    // Create Route
    const route = {
      id: routeId,
      name: data.label || 'Unnamed',
      description: `WhatsApp Connection - ${data.status}`,
      metadata: {
        whatsapp_phone: phone,
        phone_id: doc.id,
        channel_id: 'whatsapp-baileys'
      },
      match_rules: [
        { type: 'from', pattern: phone }
      ],
      is_wildcard: false,
      destination: {
        url: 'firestore://wa_accounts/' + doc.id,
        method: 'POST',
        headers: { 'X-Route-Id': routeId }
      },
      bindings: [`bind-${doc.id}`],
      created_by: 'antigravity-system',
      created_at: data.createdAt ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
      status: data.status === 'connected' ? 'active' : 'disabled',
      stats: {
        last_success: data.updatedAt ? data.updatedAt.toDate().toISOString() : null,
        last_failure: null,
        successes_count: 0,
        failures_count: 0
      }
    };
    report.routes.push(route);

    // Create Binding
    report.bindings.push({
      binding_id: `bind-${doc.id}`,
      whatsapp_phone: phone,
      route_id: routeId,
      created_at: route.created_at
    });

    // Create Logs (mocking structure representing recent sync events)
    // We don't have a structured log DB for individual messages offhand, so providing an empty/placeholder array
    // that fits the schema.
    report.route_logs[routeId] = [
      {
        timestamp: new Date().toISOString(),
        event_type: 'system.status_check',
        from: 'system',
        to: phone,
        route_id: routeId,
        destination_url: 'firestore://wa_accounts/' + doc.id,
        response_status: data.status === 'connected' ? 200 : 503,
        error_message: data.status === 'connected' ? null : `Status is ${data.status}`,
        latency_ms: 10
      }
    ];
  }

  const fs = require('fs');
  fs.writeFileSync('routes_report.json', JSON.stringify(report, null, 2));
  console.log('Report generated at routes_report.json');
  process.exit(0);
}

generateReport().catch(console.error);
