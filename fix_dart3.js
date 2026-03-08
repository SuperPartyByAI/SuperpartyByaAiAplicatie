const fs = require('fs');

let mainCode = fs.readFileSync('lib/main.dart', 'utf8');
mainCode = mainCode.replace(/Call\? getActiveCall/g, 'ActiveCall? getActiveCall');
mainCode = mainCode.replace(/Call\? activeCall/g, 'ActiveCall? activeCall');
mainCode = mainCode.replace(/activeCall\.to/g, 'activeCall.callerName'); // Just a hack, we actually don't have 'to', 'from', 'callDirection' on ActiveCall. We have 'callerName'.
mainCode = mainCode.replace(/activeCall\.callDirection/g, '"Incoming"');

fs.writeFileSync('lib/main.dart', mainCode);

let incCode = fs.readFileSync('lib/screens/incoming_call_screen.dart', 'utf8');
incCode = incCode.replace(/Call\? activeCall/g, 'ActiveCall? activeCall');
incCode = incCode.replace(/Call\? getActiveCall/g, 'ActiveCall? getActiveCall');
incCode = incCode.replace(/activeCall\.to/g, 'activeCall.callerName');
incCode = incCode.replace(/activeCall\.callDirection/g, '"Incoming"');

fs.writeFileSync('lib/screens/incoming_call_screen.dart', incCode);
