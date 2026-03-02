const fs = require('fs');

const path = '/Users/universparty/AplicatieSuperParty/Superparty-App/server/whatsapp-integration-v6-index.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Line 548 - 559: active device query
content = content.replace(
  /const devSnap = await db\.collectionGroup\('devices'\)[\s\S]*?if \(!devSnap\.empty\) {[\s\S]*?const identity = devSnap\.docs\[0\]\.data\(\)\.identity;[\s\S]*?if \(identity\) identities\.push\(identity\);[\s\S]*?}/g,
  `const { data: devSnap, error: devErr } = await supabase.from('devices').select('identity').order('last_seen', { ascending: false }).limit(1);
        if (devSnap && devSnap.length > 0) {
          const identity = devSnap[0].identity;
          if (identity) identities.push(identity);
        }`
);
content = content.replace("Query ONLY the absolute most recent active device from Firestore", "Query ONLY the absolute most recent active device from Supabase");

// 2. Line 669 - 674: fallback identities
content = content.replace(
  /const snap = await db\.collectionGroup\('devices'\)\.limit\(3\)\.get\(\);\s*fallbackIdentities = snap\.docs\.map\(d => d\.data\(\)\?\.identity\)\.filter\(Boolean\);/,
  `const { data: snap } = await supabase.from('devices').select('identity').limit(3);\n      fallbackIdentities = (snap || []).map(d => d.identity).filter(Boolean);`
);

// 3. Line 718 - 723: confName logging
content = content.replace(/timestamp: admin\.firestore\.FieldValue\.serverTimestamp\(\)/g, `timestamp: new Date().toISOString()`);
content = content.replace(
  /await db\.collection\('calls'\)\.doc\(confName\)\.set\(metadata\);\s*await db\.collection\('voiceConfs'\)\.doc\(confName\)\.set\(metadata\);/,
  `await supabase.from('voice_calls').upsert({ id: confName, ...metadata });\n    await supabase.from('voice_confs').upsert({ id: confName, ...metadata });`
);

// 4. Line 765 - 775: Voice conf tearing down
content = content.replace(
  /const doc = await db\.collection\('voiceConfs'\)\.doc\(sid\)\.get\(\);\s*if \(doc\.exists\) {\s*const data = doc\.data\(\);/,
  `const { data, error } = await supabase.from('voice_confs').select('*').eq('id', sid).single();\n          if (data && !error) {`
);

// 5. Line 790 - 805: Call status logging
content = content.replace(
  /await db\.collection\('calls'\)\.doc\(CallSid\)\.set\({[\s\S]*?timestamp: new Date\(\)\.toISOString\(\),\s*\}, { merge: true }\);/g,
  `// Migrated to Supabase in call status logging\n    await supabase.from('voice_calls').upsert({\n      id: CallSid,\n      from_phone: From || '',\n      from_clean: cleanFrom,\n      to_phone: To || '',\n      status: CallStatus || '',\n      duration: parseInt(CallDuration || '0', 10),\n      start_time: StartTime ? new Date(StartTime).toISOString() : new Date().toISOString(),\n      end_time: EndTime ? new Date(EndTime).toISOString() : null,\n      updated_at: new Date().toISOString(),\n    });`
);
content = content.replace(/admin\.firestore\.FieldValue\.serverTimestamp\(\)/g, `new Date().toISOString()`);

// 6. Line 809 - 814: Conference teardown logic fetch
content = content.replace(
  /const confDoc = await db\.collection\('voiceConfs'\)\.doc\(conf\)\.get\(\);\s*if \(confDoc\.exists\) {\s*const data = confDoc\.data\(\);/,
  `const { data, error } = await supabase.from('voice_confs').select('*').eq('id', conf).single();\n      if (data && !error) {`
);

// 7. Line 838 - 845: Recording status update
content = content.replace(
  /await db\.collection\('calls'\)\.doc\(CallSid\)\.set\({[\s\S]*?recordingDuration: parseInt\(RecordingDuration \|\| '0', 10\),\s*\}, { merge: true }\);/g,
  `await supabase.from('voice_calls').update({\n        recording_url: url,\n        recording_sid: RecordingSid,\n        recording_duration: parseInt(RecordingDuration || '0', 10),\n      }).eq('id', CallSid);`
);

// 8. Line 855: Admin UI fetch calls
content = content.replace(
  /const snap = await db\.collection\('calls'\)[\s\S]*?\.limit\(100\)[\s\S]*?\.get\(\);\s*const items = snap\.docs\.map\(d => \(\{ id: d\.id, \.\.\.d\.data\(\) \}\)\);/,
  `const { data: items, error } = await supabase.from('voice_calls').select('*').order('start_time', { ascending: false }).limit(100);`
);

// 9. Line 887: Fetch single call
content = content.replace(
  /const doc = await db\.collection\('calls'\)\.doc\(sid\)\.get\(\);\s*if \(!doc\.exists\)/,
  `const { data: docData, error } = await supabase.from('voice_calls').select('*').eq('id', sid).single();\n    if (!docData)`
);
content = content.replace(/res\.json\(\{ id: doc\.id, \.\.\.doc\.data\(\) \}\);/g, `res.json(docData);`);

// 10. Device registration
content = content.replace(
  /await db\.collection\('users'\)\.doc\(userId\)[\s\S]*?\.collection\('devices'\)\.doc\(deviceId\)\.set\({[\s\S]*?identity,[\s\S]*?os,[\s\S]*?version,[\s\S]*?lastSeen: new Date\(\)\.toISOString\(\)[\s\S]*?\}\);/g,
  `await supabase.from('devices').upsert({\n        id: deviceId,\n        user_id: userId,\n        identity,\n        os,\n        version,\n        last_seen: new Date().toISOString()\n      });`
);
content = content.replace(
  /const deviceDoc = await db\.collection\('users'\)\.doc\(userId\)\.collection\('devices'\)\.doc\(deviceId\)\.get\(\);[\s\S]*?if \(!deviceDoc\.exists\)/g,
  `const { data: deviceDoc, error } = await supabase.from('devices').select('*').eq('id', deviceId).eq('user_id', userId).single();\n    if (!deviceDoc)`
);

// Write changes
fs.writeFileSync(path, content, 'utf8');
console.log('Replacements completed successfully');
