const https = require('https');
const fs = require('fs');

async function testMaps() {
  const supabaseOptionsPath = '/Users/universparty/AplicatieSuperParty/Superparty-App/lib/supabase_options.dart';
  const dartCode = fs.readFileSync(supabaseOptionsPath, 'utf8');
  const apiKeyMatch = dartCode.match(/apiKey:\s*'([^']+)'/);
  
  if (!apiKeyMatch) {
    console.log("No API key found in supabase_options.dart");
    return;
  }
  
  const apiKey = apiKeyMatch[1];
  const url = `https://routes.googleapis.com/directions/v2:computeRoutes`;
  
  const postData = JSON.stringify({
    "origin": {
      "address": "Piata Unirii, Bucuresti"
    },
    "destination": {
      "address": "Cluj Napoca, Romania"
    },
    "travelMode": "DRIVE"
  });

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration'
    }
  };

  const req = https.request(url, options, (resp) => {
    let data = '';
    resp.on('data', (chunk) => { data += chunk; });
    resp.on('end', () => {
      console.log(data);
    });
  });
  
  req.on('error', (e) => {
    console.error(e);
  });
  
  req.write(postData);
  req.end();
}

testMaps();
