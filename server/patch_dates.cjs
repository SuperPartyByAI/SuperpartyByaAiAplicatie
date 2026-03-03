const fs = require('fs');
const file = '/Users/universparty/AplicatieSuperParty/Superparty-App/server/session-manager.js';
let content = fs.readFileSync(file, 'utf8');

// Replace all Date.now() in supabase parameters
const patches = [
    { from: "last_ping_at: nowMs", to: "last_ping_at: new Date(nowMs).toISOString()" },
    { from: "last_seen_at: nowMs", to: "last_seen_at: new Date(nowMs).toISOString()" },
    { from: "needs_qr_since: Date.now()", to: "needs_qr_since: new Date().toISOString()" },
    { from: "updated_at: Date.now()", to: "updated_at: new Date().toISOString()" },
    { from: "connected_at: Date.now()", to: "connected_at: new Date().toISOString()" },
    { from: "last_seen_at: Date.now()", to: "last_seen_at: new Date().toISOString()" }
];

patches.forEach(p => {
    content = content.split(p.from).join(p.to);
});

fs.writeFileSync(file, content, 'utf8');
console.log('Date patches applied');
