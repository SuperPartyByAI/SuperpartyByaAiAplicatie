const https = require('https');
const fs = require('fs');

async function testMaps() {
  const firebaseOptionsPath = '/Users/universparty/AplicatieSuperParty/Superparty-App/lib/firebase_options.dart';
  const dartCode = fs.readFileSync(firebaseOptionsPath, 'utf8');
  const apiKeyMatch = dartCode.match(/apiKey:\s*'([^']+)'/);
  
  if (!apiKeyMatch) {
    console.log("No API key found in firebase_options.dart");
    return;
  }
  
  const apiKey = apiKeyMatch[1];
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=Piata+Unirii,+Bucuresti&destinations=Cluj+Napoca&key=${apiKey}`;
  
  https.get(url, (resp) => {
    let data = '';
    resp.on('data', (chunk) => { data += chunk; });
    resp.on('end', () => {
      console.log(data);
    });
  }).on("error", (err) => {
    console.log("Error: " + err.message);
  });
}

testMaps();
