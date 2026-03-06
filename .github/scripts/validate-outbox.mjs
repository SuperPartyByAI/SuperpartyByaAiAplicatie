/**
 * validate-outbox.mjs — CI smoke test runner
 * Runs 7 outbox validation scenarios against Supabase REST API
 */

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPA_URL || !SUPA_KEY) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_KEY required (GitHub Secrets)');
  process.exit(1);
}

const ACCOUNT = `ci-${Date.now()}`;
let pass = 0;
let fail = 0;

const ok  = (msg) => { console.log(`✅ PASS ${msg}`); pass++; };
const err = (msg) => { console.error(`❌ FAIL ${msg}`); fail++; };

async function supaRpc(rpc, body) {
  const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${rpc}`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function supaGet(query) {
  const r = await fetch(`${SUPA_URL}/rest/v1/outbox_messages?${query}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  });
  return r.json();
}

async function supaPatch(query, body) {
  const r = await fetch(`${SUPA_URL}/rest/v1/outbox_messages?${query}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function supaDelete(query) {
  await fetch(`${SUPA_URL}/rest/v1/outbox_messages?${query}`, {
    method: 'DELETE',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  });
}

console.log(`\n🔍 WA Outbox CI Smoke — account=${ACCOUNT}`);
const IKEY1 = `ci-sc1-${ACCOUNT}`;
const TO = '40700@s.whatsapp.net';

// SC1: enqueue → queued
const msg1 = await supaRpc('enqueue_outbox_message', {
  p_idempotency_key: IKEY1,
  p_account_id: ACCOUNT,
  p_to_jid: TO,
  p_message_type: 'text',
  p_payload: { text: 'ci-test' },
});
const row1 = await supaGet(`id=eq.${msg1}&select=status`);
Array.isArray(row1) && row1[0]?.status === 'queued'
  ? ok('Sc1: enqueue → status=queued')
  : err(`Sc1: status=${row1?.[0]?.status ?? JSON.stringify(row1)}`);

// SC2: idempotency (same key → null / no duplicate)
const dup = await supaRpc('enqueue_outbox_message', {
  p_idempotency_key: IKEY1,
  p_account_id: ACCOUNT,
  p_to_jid: TO,
  p_message_type: 'text',
  p_payload: { text: 'dup' },
});
(dup === null || dup === undefined || (typeof dup === 'string' && dup === 'null'))
  ? ok('Sc2: idempotency (duplicate → null)')
  : err(`Sc2: expected null, got ${JSON.stringify(dup)}`);

// SC3: claim → sending
const claimed = await supaRpc('claim_outbox_batch', { p_account_id: ACCOUNT, p_batch_size: 5 });
const claimedRow = Array.isArray(claimed) ? claimed.find(r => r.id === msg1) : null;
claimedRow?.status === 'sending'
  ? ok('Sc3: claim_outbox_batch → status=sending')
  : err(`Sc3: not claimed or wrong status: ${JSON.stringify(claimedRow)}`);

// SC4: markSent
const sentRows = await supaPatch(`id=eq.${msg1}`, { status: 'sent', sent_at: new Date().toISOString() });
sentRows?.[0]?.status === 'sent'
  ? ok('Sc4: markSent → status=sent')
  : err(`Sc4: ${JSON.stringify(sentRows?.[0])}`);

// SC5: fail path
const msg5 = await supaRpc('enqueue_outbox_message', {
  p_idempotency_key: `ci-sc5-${ACCOUNT}`, p_account_id: ACCOUNT,
  p_to_jid: TO, p_message_type: 'text', p_payload: { text: 'f' },
});
const f5 = await supaPatch(`id=eq.${msg5}`, { status: 'failed', error_message: 'sim', attempts: 1 });
f5?.[0]?.status === 'failed' && f5?.[0]?.attempts === 1
  ? ok('Sc5: fail path → status=failed, attempts=1')
  : err(`Sc5: ${JSON.stringify(f5?.[0])}`);

// SC6: dead (DLQ)
const msg6 = await supaRpc('enqueue_outbox_message', {
  p_idempotency_key: `ci-sc6-${ACCOUNT}`, p_account_id: ACCOUNT,
  p_to_jid: TO, p_message_type: 'text', p_payload: { text: 'd' },
});
const d6 = await supaPatch(`id=eq.${msg6}`, { status: 'dead', attempts: 5, error_message: 'max' });
d6?.[0]?.status === 'dead' && d6?.[0]?.attempts === 5
  ? ok('Sc6: DLQ → status=dead, attempts=5')
  : err(`Sc6: ${JSON.stringify(d6?.[0])}`);

// SC7: replay DLQ → queued
const r7 = await supaPatch(`id=eq.${msg6}&status=eq.dead`, {
  status: 'queued', attempts: 0, error_message: null, next_retry_at: new Date().toISOString(),
});
r7?.[0]?.status === 'queued' && r7?.[0]?.attempts === 0
  ? ok('Sc7: replay DLQ → status=queued, attempts=0')
  : err(`Sc7: ${JSON.stringify(r7?.[0])}`);

// Cleanup
await supaDelete(`account_id=eq.${ACCOUNT}`);

console.log(`\n${'═'.repeat(50)}`);
console.log(`  REZULTATE: ${pass} PASS | ${fail} FAIL / 7 total`);
console.log(`${'═'.repeat(50)}\n`);

if (fail > 0) process.exit(1);
