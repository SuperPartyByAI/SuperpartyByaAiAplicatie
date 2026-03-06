/**
 * identity-resolver.mjs
 * Canonical WhatsApp client identity resolution engine.
 * Resolves a (accountId, jid, pushName) tuple into a canonical identity row.
 * Idempotent — safe to call on every inbound/outbound message.
 */

// ── JID parsing ───────────────────────────────────────────────────────────────

/**
 * Parse a raw JID into structured form.
 * @param {string} rawJid
 * @returns {{ rawJid: string, local: string, domain: string, jidType: string, phone: string|null }}
 */
export function parseJid(rawJid) {
  const jid = (rawJid || '').trim();
  const atIdx = jid.indexOf('@');
  if (atIdx < 0) return { rawJid: jid, local: jid, domain: '', jidType: 'unknown', phone: null };

  const local  = jid.slice(0, atIdx);
  const domain = jid.slice(atIdx + 1);

  let jidType = 'unknown';
  if (domain === 's.whatsapp.net') jidType = 's.whatsapp.net';
  else if (domain === 'lid')        jidType = 'lid';
  else if (domain === 'g.us')       jidType = 'group';
  else if (domain === 'broadcast')  jidType = 'broadcast';

  // Phone is only reliably extractable from @s.whatsapp.net
  const phone = jidType === 's.whatsapp.net' ? normalizePhone(local) : null;

  return { rawJid: jid, local, domain, jidType, phone };
}

// ── Phone normalization ───────────────────────────────────────────────────────

const RO_PREFIX_PATTERNS = [
  { re: /^00407/, replace: '+407' },
  { re: /^\+4407/, replace: '+407' },
  { re: /^0407/, replace: '+407' },
  { re: /^07/, replace: '+407' },
];

/**
 * Normalize a raw phone string to E.164.
 * Handles Romanian 07xx patterns and generic international.
 * @param {string} raw
 * @returns {string|null}
 */
export function normalizePhone(raw) {
  if (!raw) return null;
  // Keep only digits + leading +
  let phone = raw.replace(/[^\d+]/g, '');
  if (!phone) return null;

  // Strip leading zeros before international prefix (00xx → +xx)
  if (phone.startsWith('00')) phone = '+' + phone.slice(2);

  // Romanian patterns for local numbers
  for (const { re, replace } of RO_PREFIX_PATTERNS) {
    if (re.test(phone)) {
      phone = phone.replace(re, replace);
      break;
    }
  }

  // Ensure E.164: starts with +, minimum 7 digits
  if (!phone.startsWith('+')) phone = '+' + phone;
  const digits = phone.slice(1).replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;

  return `+${digits}`;
}

// ── Resolution engine ─────────────────────────────────────────────────────────

/**
 * Resolve or create a canonical identity for (accountId, jid, pushName).
 * Idempotent — upserts wa_jid_aliases and wa_client_identities.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string} accountId
 * @param {string} rawJid
 * @param {string|null} pushName
 * @returns {Promise<{
 *   identityId: string,
 *   phone_e164: string|null,
 *   displayName: string,
 *   resolution_status: 'resolved'|'partial'|'unresolved'
 * }>}
 */
export async function resolveOrCreateIdentity(sb, accountId, rawJid, pushName) {
  const parsed = parseJid(rawJid);

  // Groups and broadcasts don't get identity resolution
  if (parsed.jidType === 'group' || parsed.jidType === 'broadcast') {
    return {
      identityId:        null,
      phone_e164:        null,
      displayName:       pushName || rawJid.split('@')[0],
      resolution_status: 'unresolved',
    };
  }

  const now = new Date().toISOString();

  // 1. Check if this JID alias already exists
  const { data: existing } = await sb
    .from('wa_jid_aliases')
    .select('identity_id')
    .eq('jid', parsed.rawJid)
    .eq('account_id', accountId)
    .maybeSingle();

  if (existing?.identity_id) {
    // Update last_seen_at + display_name if pushName is better
    await sb.from('wa_jid_aliases')
      .update({ last_seen_at: now })
      .eq('jid', parsed.rawJid)
      .eq('account_id', accountId);

    if (pushName) {
      await sb.from('wa_client_identities')
        .update({
          display_name:        pushName,
          display_name_source: 'pushName',
          last_seen_at:        now,
          updated_at:          now,
        })
        .eq('id', existing.identity_id)
        .neq('display_name_source', 'manual'); // never overwrite manual
    }

    const { data: identity } = await sb
      .from('wa_client_identities')
      .select('id,phone_e164,display_name,resolution_status')
      .eq('id', existing.identity_id)
      .single();

    return {
      identityId:        identity.id,
      phone_e164:        identity.phone_e164,
      displayName:       identity.display_name || pushName || _fallbackName(parsed),
      resolution_status: identity.resolution_status,
    };
  }

  // 2. New JID — check if we have an existing identity by phone
  let identityId = null;
  const phone_e164 = parsed.phone;

  if (phone_e164) {
    const { data: byPhone } = await sb
      .from('wa_client_identities')
      .select('id')
      .eq('account_id', accountId)
      .eq('phone_e164', phone_e164)
      .maybeSingle();
    if (byPhone) identityId = byPhone.id;
  }

  const resolution_status = phone_e164 ? 'resolved' : (parsed.jidType === 'lid' ? 'partial' : 'unresolved');
  const displayName = pushName || (phone_e164 ? phone_e164 : _fallbackName(parsed));
  const displayNameSource = pushName ? 'pushName' : (phone_e164 ? 'inferred' : 'inferred');

  // 3. Create identity if not found
  if (!identityId) {
    const { data: newIdentity, error: ie } = await sb
      .from('wa_client_identities')
      .insert({
        account_id:           accountId,
        phone_e164:           phone_e164,
        display_name:         displayName,
        display_name_source:  displayNameSource,
        wa_primary_jid:       parsed.jidType === 's.whatsapp.net' ? parsed.rawJid : null,
        resolution_status,
        first_seen_at:        now,
        last_seen_at:         now,
        last_resolved_at:     phone_e164 ? now : null,
        created_at:           now,
        updated_at:           now,
      })
      .select('id')
      .single();

    if (ie) throw new Error(`[IdentityResolver] Failed to create identity: ${ie.message}`);
    identityId = newIdentity.id;
  }

  // 4. Register JID alias
  const { error: ae } = await sb
    .from('wa_jid_aliases')
    .upsert({
      jid:          parsed.rawJid,
      account_id:   accountId,
      identity_id:  identityId,
      jid_type:     parsed.jidType,
      phone_e164:   phone_e164,
      first_seen_at: now,
      last_seen_at:  now,
    }, { onConflict: 'jid,account_id', ignoreDuplicates: false });

  if (ae) throw new Error(`[IdentityResolver] Failed to upsert alias: ${ae.message}`);

  return { identityId, phone_e164, displayName, resolution_status };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _fallbackName(parsed) {
  // For @lid, show a truncated opaque identifier
  if (parsed.jidType === 'lid') return `WA-${parsed.local.slice(-6)}`;
  // For @s.whatsapp.net without phone normalization
  return parsed.local || parsed.rawJid;
}

// ── CLI self-test ─────────────────────────────────────────────────────────────

if (process.argv.includes('--test')) {
  const cases = [
    ['40737571397@s.whatsapp.net', 'Andrei', '+40737571397', 'resolved'],
    ['0737571397@s.whatsapp.net', null, '+40737571397', 'resolved'],
    ['153407742578775@lid', 'Test User', null, 'partial'],
    ['120363294491898146@g.us', null, null, 'unresolved'],
    ['invalid', null, null, 'unresolved'],
  ];

  let pass = 0;
  for (const [jid, push, expectedPhone, expectedStatus] of cases) {
    const parsed = parseJid(jid);
    const ok = parsed.phone === expectedPhone;
    const statusOk = (parsed.jidType === 'group' || parsed.jidType === 'broadcast' || parsed.jidType === 'unknown')
      ? expectedStatus === 'unresolved'
      : (parsed.phone ? expectedStatus === 'resolved' : (parsed.jidType === 'lid' ? expectedStatus === 'partial' : true));
    console.log(ok && statusOk ? '✅' : '❌', jid, '→ phone:', parsed.phone, 'type:', parsed.jidType);
    if (ok && statusOk) pass++;
  }
  console.log(`\n${pass}/${cases.length} tests passed`);
  process.exit(pass === cases.length ? 0 : 1);
}
