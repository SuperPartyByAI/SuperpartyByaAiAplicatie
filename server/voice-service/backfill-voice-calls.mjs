#!/usr/bin/env node
/**
 * backfill-voice-calls.mjs
 * Import apeluri din Twilio API -> Supabase voice_calls
 * Idempotent (upsert cu on_conflict=call_sid&resolution=ignore-duplicates)
 *
 * Usage:
 *   TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... \
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
 *   node backfill-voice-calls.mjs [--days=7] [--dry-run]
 */

import 'dotenv/config';
import Twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';

const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const SUPA_URL     = process.env.SUPABASE_URL;
const SUPA_KEY     = process.env.SUPABASE_SERVICE_KEY;

const args   = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const daysArg = args.find(a => a.startsWith('--days='));
const DAYS   = daysArg ? Number.parseInt(daysArg.split('=')[1], 10) : 7;

if (!TWILIO_SID || !TWILIO_TOKEN || !SUPA_URL || !SUPA_KEY) {
  console.error('❌ Missing env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const twilioClient = Twilio(TWILIO_SID, TWILIO_TOKEN);
const supa         = createClient(SUPA_URL, SUPA_KEY);
const headers      = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };

async function resolveIdentities(from) {
  const result = { agentUserId: null, agentIdentity: null, clientIdentityId: null, clientDisplayName: null, conversationId: null };
  if (!from) return result;
  if (from.startsWith('client:')) {
    const m = from.replace('client:', '').match(/^user_([0-9a-f-]{36})_dev_/i);
    if (m) {
      result.agentUserId   = m[1];
      result.agentIdentity = from.replace('client:', '');
    }
  } else if (from.startsWith('+')) {
    const resp = await fetch(`${SUPA_URL}/rest/v1/conversations_public?phone=eq.${encodeURIComponent(from)}&select=id,identity_id,client_display_name&limit=1`, { headers }).then(r => r.ok ? r.json() : []).catch(() => []);
    if (resp[0]) {
      result.clientIdentityId  = resp[0].identity_id || null;
      result.clientDisplayName = resp[0].client_display_name || null;
      result.conversationId    = resp[0].id || null;
    }
  }
  return result;
}

async function upsertRow(row) {
  const resp = await fetch(`${SUPA_URL}/rest/v1/voice_calls?on_conflict=call_sid`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify(row),
  });
  return resp.status;
}

async function main() {
  const cutoff = new Date(Date.now() - DAYS * 86400_000);
  console.log(`📦 Backfill voice_calls: last ${DAYS} days${dryRun ? ' [DRY RUN]' : ''}`);

  // twilio.calls.list fetches all pages internally when limit is large enough
  const calls = await twilioClient.calls.list({ startTimeAfter: cutoff, limit: 1000 });
  console.log(`   Twilio returned: ${calls.length} calls`);

  let inserted = 0, skipped = 0, errors = 0;

  for (const c of calls) {
    const from = c.from || '';
    const ids  = await resolveIdentities(from);
    const row  = {
      call_sid:            c.sid,
      parent_call_sid:     c.parentCallSid || null,
      direction:           from.startsWith('client:') ? 'outbound' : 'inbound',
      from_raw:            from || null,
      to_raw:              c.to || null,
      status:              c.status,
      duration_seconds:    c.duration ? Number.parseInt(c.duration, 10) : null,
      started_at:          c.startTime ? c.startTime.toISOString() : null,
      ended_at:            c.endTime   ? c.endTime.toISOString()   : null,
      twilio_account_sid:  c.accountSid || TWILIO_SID,
      twilio_from:         from || null,
      twilio_to:           c.to || null,
      agent_identity:      ids.agentIdentity,
      agent_user_id:       ids.agentUserId,
      client_identity_id:  ids.clientIdentityId,
      client_display_name: ids.clientDisplayName,
      conversation_id:     ids.conversationId,
      source_system:       'voice',
      metadata:            { backfilled: true },
    };

    if (dryRun) {
      console.log(`  [DRY] ${c.sid} from=${from} client=${ids.clientDisplayName || '-'}`);
      inserted++;
      continue;
    }

    const status = await upsertRow(row);
    if (status === 200 || status === 201) { inserted++; process.stdout.write('.'); }
    else if (status === 409) { skipped++; process.stdout.write('s'); }
    else { errors++; console.error(`\n❌ Error ${status} for ${c.sid}`); }

    // Rate limit: 100ms between rows
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n\n✅ Backfill done: inserted=${inserted} skipped=${skipped} errors=${errors}`);
  if (errors > 0) process.exit(1);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
