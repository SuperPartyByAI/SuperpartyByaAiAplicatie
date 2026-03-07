/**
 * validate-voice-persistence.mjs
 * CI smoke test: voice_calls persistence (INSERT, UPSERT, SELECT, cleanup)
 * Runs against isolated CI Supabase project (not prod!)
 * 
 * CI Supabase: vpacynuyljmiatcqemho.supabase.co
 * Requires: voice_calls table applied manually in CI project
 */

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPA_URL || !SUPA_KEY) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_KEY required');
  process.exit(1);
}

const TEST_SID = `ci-call-${Date.now()}`;
let pass = 0, fail = 0;
const ok  = msg => { console.log(`✅ PASS ${msg}`); pass++; };
const err = msg => { console.error(`❌ FAIL ${msg}`); fail++; };

async function rpc(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, opts);
  return { status: r.status, data: await r.json().catch(() => null) };
}

async function main() {
  console.log('🧪 Voice Persistence CI — Smoke Tests');
  console.log(`   Project: ${SUPA_URL.replace('https://', '').split('.')[0]}`);
  
  // Verify prod isolation
  const PROD_MARKER = 'ilkphpidhuytucxlglqi';
  if (SUPA_URL.includes(PROD_MARKER)) {
    console.error('❌ CRITICAL: CI is using PRODUCTION Supabase! Abort.');
    process.exit(1);
  }
  ok('CI isolated from prod');

  // T1: Table exists
  const { status: tableStatus } = await rpc('voice_calls?limit=1');
  if (tableStatus === 200) ok('voice_calls table exists');
  else { err(`voice_calls table not found (${tableStatus})`); process.exit(1); }

  // T2: INSERT new call
  const { status: insertStatus, data: insertData } = await rpc('voice_calls', 'POST', {
    call_sid: TEST_SID,
    direction: 'inbound',
    from_raw: '+40799000111',
    to_raw: '+40373000000',
    status: 'initiated',
    started_at: new Date().toISOString(),
    source_system: 'voice',
  });
  if (insertStatus === 201) ok('INSERT new call');
  else err(`INSERT failed (${insertStatus}): ${JSON.stringify(insertData)}`);

  // T3: SELECT confirms presence
  const { data: selectData } = await rpc(`voice_calls?call_sid=eq.${TEST_SID}&select=call_sid,status`);
  if (Array.isArray(selectData) && selectData[0]?.call_sid === TEST_SID) ok('SELECT confirms inserted row');
  else err('SELECT did not find inserted row');

  // T4: UPSERT updates status (idempotent)
  const { status: upsertStatus } = await rpc('voice_calls', 'POST', {
    call_sid:        TEST_SID,
    status:          'completed',
    duration_seconds: 42,
    ended_at:        new Date().toISOString(),
  });
  // Supabase upsert via POST with Prefer: resolution=merge-duplicates
  const upsertHeaders = {
    apikey: SUPA_KEY,
    Authorization: `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation,resolution=merge-duplicates',
  };
  const upsertResp = await fetch(`${SUPA_URL}/rest/v1/voice_calls?on_conflict=call_sid`, {
    method: 'POST',
    headers: upsertHeaders,
    body: JSON.stringify({
      call_sid: TEST_SID,
      status: 'completed',
      duration_seconds: 42,
      ended_at: new Date().toISOString(),
    }),
  });
  if (upsertResp.status === 200 || upsertResp.status === 201) ok('UPSERT updates existing row (idempotent)');
  else err(`UPSERT failed (${upsertResp.status})`);

  // T5: Verify status updated
  const { data: updData } = await rpc(`voice_calls?call_sid=eq.${TEST_SID}&select=status,duration_seconds`);
  if (updData?.[0]?.status === 'completed' && updData?.[0]?.duration_seconds === 42) ok('Status + duration updated correctly');
  else err(`Status update verification failed: ${JSON.stringify(updData?.[0])}`);

  // T6: Duplicate INSERT is tolerant
  const { status: dupStatus } = await fetch(`${SUPA_URL}/rest/v1/voice_calls`, {
    method: 'POST',
    headers: { ...upsertHeaders, Prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify({ call_sid: TEST_SID, status: 'initiated' }),
  }).then(r => ({ status: r.status }));
  if (dupStatus === 200 || dupStatus === 201) ok('Duplicate INSERT tolerated (ignoreDuplicates)');
  else err(`Duplicate INSERT not handled gracefully (${dupStatus})`);

  // Cleanup
  const { status: delStatus } = await rpc(`voice_calls?call_sid=eq.${TEST_SID}`, 'DELETE');
  if (delStatus === 200 || delStatus === 204) ok('Cleanup DELETE');
  else err(`Cleanup DELETE failed (${delStatus})`);

  console.log(`\n📊 Results: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
  console.log('✅ Voice persistence: ALL PASSED');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
