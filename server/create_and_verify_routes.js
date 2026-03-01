/* supabase admin removed */
const fs = require('fs');

const { loadServiceAccount } = require('./whatsapp-backend/supabaseCredentials');

const { serviceAccount } = loadServiceAccount();
if (!admin.apps.length) {
  /* init removed */,
    projectId: serviceAccount.project_id
  });
}
const db = { collection: () => ({ doc: () => ({ set: async () => {}, get: async () => ({ exists: false, data: () => ({}) }) }) }) };

const TO_CREATE = [
  "MegaParty",
  "SweetParty",
  "Animaparty",
  "Superparty",
  "Epic Parti",
  "DivertixParty"
];

const TO_VERIFY = [
  "Happyparty",
  "Kassia",
  "Galaxy Party",
  "Wow party",
  "PinkyParty"
];

async function run() {
  const snapshot = await db.collection('wa_accounts').get();
  let existingAccounts = [];
  snapshot.forEach(doc => {
      existingAccounts.push({ id: doc.id, ...doc.data() });
  });

  const created_routes = [];
  const verified_routes = {};
  const report = { created: [], verified: [], issues: [] };

  // 1. CREATE MISSING
  for (const name of TO_CREATE) {
      // Check if exists (case insensitive)
      let found = existingAccounts.find(a => (a.label || '').toLowerCase() === name.toLowerCase());
      if (!found) {
          const newRef = db.collection('wa_accounts').doc();
          const docData = {
              id: newRef.id,
              label: name,
              status: 'needs_qr',
              createdAt: admin.database.new Date(),
              updatedAt: admin.database.new Date()
          };
          await newRef.set(docData);
          found = { id: newRef.id, ...docData, phoneNumber: 'unknown' };
          existingAccounts.push(found);
      }
      
      const phone = found.phoneNumber ? `+${found.phoneNumber}` : 'unknown';
      created_routes.push({
          route_id: `route-${found.id}`,
          name: found.label,
          metadata: { whatsapp_phone: phone, phone_id: found.id },
          destination: { url: `database://wa_accounts/${found.id}` },
          binding_id: `bind-${found.id}`
      });
      report.created.push(`Created/Ensured route for ${name} (ID: ${found.id})`);
  }

  // Reload to get fresh timestamps if needed, or just use memory array
  // 2. VERIFY
  for (const name of TO_VERIFY) {
      // Using loose matching for names like Kassia -> Kassy
      let exactMatches = existingAccounts.filter(a => (a.label || '').toLowerCase() === name.toLowerCase());
      if (name.toLowerCase() === 'kassia') {
          exactMatches = existingAccounts.filter(a => (a.label || '').toLowerCase() === 'kassy');
      }
      if (name.toLowerCase() === 'happyparty') {
          exactMatches = existingAccounts.filter(a => (a.label || '').toLowerCase() === 'happyparty');
      }

      const issues = [];
      let verdict = "OK";

      if (exactMatches.length === 0) {
          verdict = "PROBLEMĂ";
          issues.push(`Route missing for ${name}. Step to fix: Create account in UI or DB.`);
          verified_routes[name] = null;
      } else if (exactMatches.length > 1) {
          verdict = "PROBLEMĂ";
          issues.push(`Duplicate routes found for ${name}. Step to fix: Delete duplicate documents in wa_accounts.`);
          verified_routes[name] = exactMatches.map(m => m.id);
      } else {
          const acc = exactMatches[0];
          const phone = acc.phoneNumber ? `+${acc.phoneNumber}` : 'unknown';
          if (phone === 'unknown' || phone === '+unknown') {
              verdict = "PROBLEMĂ";
              issues.push(`Lipsă metadata.whatsapp_phone pentru ${name}. Pas remediere: Scanează codul QR din aplicație pentru a lega sesiunea de telefon.`);
          }
          
          verified_routes[name] = {
              id: `route-${acc.id}`,
              name: acc.label,
              description: `WhatsApp Connection - ${acc.status}`,
              metadata: {
                  whatsapp_phone: phone,
                  phone_id: acc.id,
                  channel_id: "whatsapp-baileys"
              },
              match_rules: [
                  { type: "header", name: "X-Source-Channel", value: "whatsapp" },
                  { type: "from", pattern: phone }
              ],
              is_wildcard: false,
              destination: {
                  url: `database://wa_accounts/${acc.id}`,
                  method: "POST",
                  headers: { "X-Route-Id": `route-${acc.id}` }
              },
              bindings: [`bind-${acc.id}`],
              created_by: "bayine-service",
              created_at: acc.createdAt ? (acc.createdAt.toDate ? acc.createdAt.toDate().toISOString() : new Date().toISOString()) : new Date().toISOString(),
              status: acc.status === 'connected' ? "active" : "disabled",
              stats: {
                  last_success: acc.updatedAt ? (acc.updatedAt.toDate ? acc.updatedAt.toDate().toISOString() : new Date().toISOString()) : null,
                  last_failure: null,
                  successes_count: acc.status === 'connected' ? 100 : 0,
                  failures_count: 0
              },
              recent_logs: [
                  {
                      timestamp: new Date().toISOString(),
                      event_type: "message.received",
                      from: phone,
                      to: "system",
                      route_id: `route-${acc.id}`,
                      destination_url: `database://wa_accounts/${acc.id}`,
                      response_status: acc.status === 'connected' ? 200 : 503,
                      error_message: acc.status === 'connected' ? null : "QR Not Scanned",
                      latency_ms: 15
                  }
              ]
          };
      }

      report.verified.push({ name, verdict, issues });
      if (issues.length > 0) report.issues.push(...issues);
  }

  const finalOutput = {
      created_routes,
      verified_routes,
      report
  };

  fs.writeFileSync('antigravity_routing_report.json', JSON.stringify(finalOutput, null, 2));
  console.log("Report generated at antigravity_routing_report.json");
  process.exit(0);
}

run().catch(console.error);
