const fs = require('fs');
const file = '/Users/universparty/AplicatieSuperParty/Superparty-App/server/session-manager.js';
let content = fs.readFileSync(file, 'utf8');

const patches = [
    { from: "s.status === 'connected'", to: "s.state === 'connected'" },
    { from: "sessionData.status =", to: "sessionData.state =" },
    { from: "status: 'connecting'", to: "state: 'connecting'" },
    { from: "status: 'needs_qr'", to: "state: 'needs_qr'" },
    { from: "s.status === 'needs_qr'", to: "s.state === 'needs_qr'" }
];

patches.forEach(p => {
    content = content.split(p.from).join(p.to);
});

fs.writeFileSync(file, content, 'utf8');
console.log('Session RAM patches applied');
