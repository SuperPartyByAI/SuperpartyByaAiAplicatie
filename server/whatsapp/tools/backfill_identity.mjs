/**
 * backfill_identity.mjs
 * Backfill canonical identities for all existing conversations + messages.
 * Idempotent — safe to re-run. Skips JIDs already in wa_jid_aliases.
 *
 * Usage:
 *   node server/whatsapp/tools/backfill_identity.mjs [--dry-run]
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { resolveOrCreateIdentity } from '../lib/identity-resolver.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

if (!process.env.SUPABASE_SERVICE_KEY) {
  console.error('[Backfill] SUPABASE_SERVICE_KEY missing');
  process.exit(1);
}

async function main() {
  console.log(`[Backfill] Starting identity backfill${DRY_RUN ? ' (DRY RUN)' : ''} at ${new Date().toISOString()}`);

  // 1. Collect distinct (account_id, jid) from conversations
  const { data: convs, error: ce } = await sb
    .from('conversations')
    .select('id,account_id,jid,identity_id')
    .not('account_id', 'is', null)
    .not('jid', 'is', null)
    .order('account_id', { ascending: true });

  if (ce) { console.error('[Backfill] conversations query error:', ce.message); process.exit(1); }

  // Also collect push_name from messages for each jid
  const { data: msgNames } = await sb
    .from('messages')
    .select('account_id,conversation_id,push_name')
    .not('push_name', 'is', null)
    .not('push_name', 'eq', '')
    .order('timestamp', { ascending: false });

  // Build pushName lookup: convId → pushName (most recent non-empty)
  const pushNameMap = {};
  for (const m of msgNames || []) {
    if (!pushNameMap[m.conversation_id]) pushNameMap[m.conversation_id] = m.push_name;
  }

  const stats = { total: 0, resolved: 0, partial: 0, unresolved: 0, skipped: 0, errors: 0 };

  for (const conv of convs) {
    stats.total++;
    const { id: convId, account_id: accountId, jid, identity_id } = conv;

    // Skip if already linked to an identity
    if (identity_id) { stats.skipped++; continue; }
    if (!jid || !accountId) { stats.unresolved++; continue; }

    const pushName = pushNameMap[convId] || null;

    try {
      if (DRY_RUN) {
        const { resolveOrCreateIdentity: _, ...rest } = await import('../lib/identity-resolver.mjs');
        const { parseJid, normalizePhone } = await import('../lib/identity-resolver.mjs');
        const parsed = parseJid(jid);
        const status = parsed.phone ? 'resolved' : (parsed.jidType === 'lid' ? 'partial' : 'unresolved');
        console.log(`  [dry] accnt=${accountId.slice(0,8)} jid=${jid.slice(0,35).padEnd(35)} status=${status} name=${pushName||'-'}`);
        stats[status]++;
        continue;
      }

      const result = await resolveOrCreateIdentity(sb, accountId, jid, pushName);

      // Update conversation with identity_id
      await sb.from('conversations').update({
        identity_id:         result.identityId,
        client_display_name: result.displayName || null,
        phone:               result.phone_e164 || null,
      }).eq('id', convId);

      stats[result.resolution_status]++;

      if (stats.total % 50 === 0) {
        console.log(`[Backfill] Progress: ${stats.total} processed...`);
      }

    } catch (e) {
      console.error(`[Backfill] Error for conv ${convId}:`, e.message);
      stats.errors++;
    }
  }

  console.log('\n[Backfill] ── RESULT ──────────────────────────────────');
  console.log(`  Total conversations : ${stats.total}`);
  console.log(`  Already linked      : ${stats.skipped}`);
  console.log(`  ✅ Resolved         : ${stats.resolved}`);
  console.log(`  ⚠️  Partial (@lid)   : ${stats.partial}`);
  console.log(`  ❓ Unresolved       : ${stats.unresolved}`);
  console.log(`  ❌ Errors           : ${stats.errors}`);
  console.log(`[Backfill] Done at ${new Date().toISOString()}`);
  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch(e => { console.error('[Backfill] Fatal:', e); process.exit(1); });
