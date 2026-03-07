/**
 * validate-voice-persistence.mjs
 * CI smoke test: voice_calls persistence (INSERT, UPSERT, SELECT, cleanup)
 * Runs against isolated CI Supabase project (not prod!)
 * CI Supabase: vpacynuyljmiatcqemho.supabase.co
 * Requires: voice_calls table applied in CI project first
 */

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPA_URL || !SUPA_KEY) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_KEY required');
  process.exit(1);
}

const TEST_SID = `ci-call-${Date.now()}`;
let pass = 0;
let fail = 0;
const ok  = msg => { console.log(`✅ PASS ${msg}`); pass++; };
const err = msg => { console.error(`❌ FAIL ${msg}`); fail++; };

const BASE_HEADERS = {
  apikey: SUPA_KEY,
  Authorization: `Bearer ${SUPA_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

async function supaGet(path) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: BASE_HEADERS });
  return { status: r.status, data: await r.json().catch(() => null) };
}

async function supaPost(path, body, prefer = 'return=minimal') {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { ...BASE_HEADERS, Prefer: prefer },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}

async function supaDelete(path) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: BASE_HEADERS,
  });
  return r.status;
}

async function main() {
  console.log('🧪 Voice Persistence CI — Smoke Tests');
  console.log(`   Project: ${SUPA_URL.replace('https://', '').split('.')[0]}`);

  // Verify prod isolation
  if (SUPA_URL.includes('ilkphpidhuytucxlglqi')) {
    console.error('❌ CRITICAL: CI is using PRODUCTION Supabase! Abort.');
    process.exit(1);
  }
  ok('CI isolated from prod');

  // T1: Table exists
  const { status: s1 } = await supaGet('voice_calls?limit=1');
  if (s1 === 200) ok('voice_calls table exists');
  else { err(`voice_calls table not found (${s1})`); process.exit(1); }

  // T2: INSERT new call
  const { status: s2 } = await supaPost('voice_calls', {
    call_sid: TEST_SID,
    direction: 'inbound',
    from_raw: '+40799000111',
    to_raw: '+40373000000',
    status: 'initiated',
    started_at: new Date().toISOString(),
    source_system: 'voice',
  });
  if (s2 === 201 || s2 === 200) ok('INSERT new call');
  else err(`INSERT failed (${s2})`);

  // T3: SELECT confirms presence
  const { data: d3 } = await supaGet(`voice_calls?call_sid=eq.${TEST_SID}&select=call_sid,status`);
  if (Array.isArray(d3) && d3[0]?.call_sid === TEST_SID) ok('SELECT confirms inserted row');
  else err('SELECT did not find inserted row');

  // T4: UPSERT updates status (idempotent)
  const r4 = await fetch(`${SUPA_URL}/rest/v1/voice_calls?on_conflict=call_sid`, {
    method: 'POST',
    headers: { ...BASE_HEADERS, Prefer: 'return=minimal,resolution=merge-duplicates' },
    body: JSON.stringify({ call_sid: TEST_SID, status: 'completed', duration_seconds: 42 }),
  });
  if (r4.status === 200 || r4.status === 201) ok('UPSERT updates existing row (idempotent)');
  else err(`UPSERT failed (${r4.status})`);

  // T5: Verify status updated
  const { data: d5 } = await supaGet(`voice_calls?call_sid=eq.${TEST_SID}&select=status,duration_seconds`);
  if (d5?.[0]?.status === 'completed' && d5?.[0]?.duration_seconds === 42) ok('Status + duration updated correctly');
  else err(`Update verification failed: ${JSON.stringify(d5?.[0])}`);

  // T6: Duplicate INSERT is tolerated (ignore-duplicates)
  const r6 = await fetch(`${SUPA_URL}/rest/v1/voice_calls?on_conflict=call_sid`, {
    method: 'POST',
    headers: { ...BASE_HEADERS, Prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify({ call_sid: TEST_SID, status: 'initiated' }),
  });
  if (r6.status === 200 || r6.status === 201) ok('Duplicate INSERT tolerated (ignore-duplicates)');
  else err(`Duplicate INSERT not handled (${r6.status})`);

  // Cleanup
  const ds = await supaDelete(`voice_calls?call_sid=eq.${TEST_SID}`);
  if (ds === 200 || ds === 204) ok('Cleanup DELETE');
  else err(`Cleanup DELETE failed (${ds})`);

  console.log(`\n📊 Results: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
  console.log('✅ Voice persistence: ALL PASSED');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
