// server/reconciler.js
// Reconciler module for WhatsApp Baileys reconnection backlog processing
// Requires: @supabase/supabase-js and libphonenumber-js
// Environment variables required: SUPABASE_URL, SUPABASE_SERVICE_KEY
// Usage: const { reconcileAccount } = require('./server/reconciler');
//        reconcileAccount(accountId, sock);

import { createClient } from '@supabase/supabase-js';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ilkphpidhuytucxlglqi.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

let serverSupabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  serverSupabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
  });
} else {
  console.warn('[Reconciler] SUPABASE_URL or SUPABASE_SERVICE_KEY not set, reconciler disabled.');
}

/**
 * normalizePhoneForServer(raw, defaultCountry)
 * returns E.164 or null
 */
export function normalizePhoneForServer(raw, defaultCountry = 'RO') {
  if (!raw) return null;
  try {
    let candidate = raw.toString().trim();
    if (candidate.includes('@')) candidate = candidate.split('@')[0];
    const p = parsePhoneNumberFromString(candidate, defaultCountry);
    if (p && p.isValid()) return p.number;
  } catch (e) {
    // fallback below
  }
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0')) return '+40' + digits.replace(/^0+/, '');
  if (digits.length >= 9) return '+' + digits;
  return null;
}

/**
 * upsertClientServer(phone, displayName)
 * - ensures clients and clients_private rows exist
 * - returns clientId (uuid) or null on failure
 */
export async function upsertClientServer(phone, displayName) {
  if (!serverSupabase) throw new Error('Supabase not configured');
  if (!phone) return null;

  try {
    // Try to find by phone in clients_private
    let res = await serverSupabase
      .from('clients_private')
      .select('client_id')
      .eq('phone', phone)
      .limit(1);

    if (res.error) throw res.error;

    if (res.data && res.data.length > 0) {
      return res.data[0].client_id;
    }

    // If not found, insert or find clients record
    // Try find clients by phone via join -- but simpler: insert client then clients_private
    // Create client
    let clientId = null;

    const { data: existingClientByName, error: nameErr } = await serverSupabase
      .from('clients')
      .select('id')
      .eq('display_name', displayName)
      .limit(1);

    if (nameErr) {
      // ignore
    }
    if (existingClientByName && existingClientByName.length > 0) {
      clientId = existingClientByName[0].id;
    } else {
      const { data: newClient, error: newErr } = await serverSupabase
        .from('clients')
        .insert({ display_name: displayName || null, source: 'whatsapp_inbound' })
        .select('id')
        .single();
      if (newErr) {
        // possible concurrency or other error; try to find by display_name
        const { data: retry } = await serverSupabase
          .from('clients')
          .select('id')
          .eq('display_name', displayName)
          .limit(1);
        if (retry && retry.length) clientId = retry[0].id;
        else throw newErr;
      } else {
        clientId = newClient.id;
      }
    }

    // Insert clients_private (phone)
    const { error: privErr } = await serverSupabase
      .from('clients_private')
      .insert({ client_id: clientId, phone })
      .select();
    if (privErr) {
      // If conflict because another process inserted, attempt to read by phone again
      const { data: cp } = await serverSupabase
        .from('clients_private')
        .select('client_id')
        .eq('phone', phone)
        .limit(1);
      if (cp && cp.length) return cp[0].client_id;
      // otherwise throw
      throw privErr;
    }
    return clientId;
  } catch (e) {
    console.error('[Reconciler] upsertClientServer error', e?.message || e);
    return null;
  }
}

/**
 * ensureConversation(accountId, canonicalJid, clientId)
 * returns conversation id
 */
export async function ensureConversation(accountId, canonicalJid, clientId) {
  if (!serverSupabase) throw new Error('Supabase not configured');
  try {
    const { data: existing } = await serverSupabase
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('jid', canonicalJid)
      .limit(1);

    if (existing && existing.length > 0) return existing[0].id;

    // create conversation
    const { data: newConv, error } = await serverSupabase
      .from('conversations')
      .insert({
        id: `${accountId}_${canonicalJid}`,
        account_id: accountId,
        client_id: clientId,
        jid: canonicalJid,
        created_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (error) {
      // possible race: another process created; try select again
      const { data: retry } = await serverSupabase
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('jid', canonicalJid)
        .limit(1);
      if (retry && retry.length) return retry[0].id;
      throw error;
    }
    return newConv.id;
  } catch (e) {
    console.error('[Reconciler] ensureConversation error', e?.message || e);
    throw e;
  }
}

/**
 * upsertMessageToSupabase(msg)
 * msg: { conversation_id, wa_message_id, direction, from_jid, to_jid, text, metadata, created_at }
 */
export async function upsertMessageToSupabase(msg) {
  if (!serverSupabase) throw new Error('Supabase not configured');
  try {
    // Try insert; if duplicate (unique constraint on wa_message_id) -> ignore
    const insertObj = {
      conversation_id: msg.conversation_id,
      wa_message_id: msg.wa_message_id || null,
      direction: msg.direction || 'inbound',
      from_jid: msg.from_jid || null,
      to_jid: msg.to_jid || null,
      text: msg.text || null,
      metadata: msg.metadata ? JSON.parse(msg.metadata) : null,
      mediaPath: msg.media_id || null,
      timestamp: msg.created_at ? new Date(msg.created_at).toISOString() : new Date().toISOString() // Note: Supabase columns might be different (using timestamp instead of created_at)
    };
    
    // Fallback based on LIVE schema "messages": id, conversation_id, text, type, from_me, push_name, timestamp, media_url, mimetype, created_at
    const adjustedObj = {
      id: msg.wa_message_id || `rec-${Date.now()}-${Math.floor(Math.random()*1000)}`,
      conversation_id: msg.conversation_id,
      text: msg.text || '',
      type: 'text',
      timestamp: insertObj.timestamp ? new Date(insertObj.timestamp).getTime() : Date.now(),
      from_me: msg.direction === 'outbound' ? true : false,
      media_url: null,
      push_name: msg.push_name || '',
      created_at: new Date().toISOString()
    };
    
    // Using upsert instead of insert precisely based on supabase-sync logic
    const { error } = await serverSupabase
      .from('messages')
      .upsert(adjustedObj, { onConflict: 'id', ignoreDuplicates: false });

    if (error) {
      // Ignore duplicate key errors
      const msgText = (error.message || '').toLowerCase();
      if (msgText.includes('duplicate') || msgText.includes('unique') || msgText.includes('violates')) {
        // duplicate: ignore
        return;
      }
      console.debug('[Reconciler] insert message error (non-duplicate)', error);
    }
  } catch (e) {
    console.error('[Reconciler] upsertMessageToSupabase unexpected error', e?.message || e);
  }
}

/**
 * processBaileysMessagesBatch(messages, mapJidToConvId)
 * messages: array of Baileys message objects
 * mapJidToConvId: { '407...@s.whatsapp.net': convId, ... }
 * returns max timestamp processed (ms)
 */
export async function processBaileysMessagesBatch(messages, mapJidToConvId) {
  let maxTs = null;
  for (const m of messages) {
    try {
      const remote = m.key?.remoteJid || m.key?.participant || null;
      if (!remote) continue;
      const convId = mapJidToConvId[remote];
      if (!convId) continue;

      // Determine timestamp
      let ts = null;
      if (m.messageTimestamp) ts = Number(m.messageTimestamp) * 1000;
      else if (m.message && m.message.timestamp) ts = Number(m.message.timestamp) * 1000;
      else ts = Date.now();

      let text = null;
      if (m.message?.conversation) text = m.message.conversation;
      else if (m.message?.extendedTextMessage?.text) text = m.message.extendedTextMessage.text;
      else if (m.message?.imageMessage?.caption) text = m.message.imageMessage.caption;
      else if (m.message?.videoMessage?.caption) text = m.message.videoMessage.caption;
      else if (m.message?.buttonsResponseMessage?.selectedButtonId) text = m.message.buttonsResponseMessage.selectedButtonId;
      else text = null;

      const waId = m.key?.id || null;
      const pushName = m.pushName || m.push_name || (m.message?.pushName) || null;

      const dbMsg = {
        conversation_id: convId,
        wa_message_id: waId,
        direction: m.key?.fromMe ? 'outbound' : 'inbound',
        from_jid: remote,
        to_jid: null,
        text: text,
        push_name: pushName,
        metadata: JSON.stringify(m),
        created_at: new Date(ts).toISOString()
      };

      await upsertMessageToSupabase(dbMsg);

      if (!maxTs || ts > maxTs) maxTs = ts;
    } catch (e) {
      console.error('[Reconciler] processBaileysMessagesBatch error', e?.message || e);
    }
  }
  return maxTs;
}

/**
 * reconcileAccount(accountId, sock, options)
 * - listens for messages.upsert during a short window and also attempts explicit fetch per conv if available
 */
export async function reconcileAccount(accountId, sock, options = {}) {
  if (!serverSupabase) {
    console.warn('[Reconciler] skipping reconcile - Supabase not configured');
    return;
  }
  const TIMEOUT_MS = options.timeoutMs || 30000;
  const INACTIVITY_MS = options.inactivityMs || 7000;

  console.info(`[Reconciler] Starting reconcile for account=${accountId}`);

  // fetch conversations with pagination
  const PAGE = options.convPageSize || 200;
  let offset = 0;
  const convs = [];
  while (true) {
    const { data: pageConvs, error: pageErr } = await serverSupabase
      .from('conversations')
      .select('id,jid,last_synced_at')
      .eq('account_id', accountId)
      .order('last_message_at', { ascending: false })
      .range(offset, offset + PAGE - 1);
    
    if (pageErr) {
      console.error('[Reconciler] failed fetching convs page', offset, pageErr);
      break;
    }
    if (!pageConvs || pageConvs.length === 0) break;
    convs.push(...pageConvs);
    offset += PAGE;
    // small sleep to avoid hammering connection pool
    await new Promise(r => setTimeout(r, 150));
  }

  if (convs.length === 0) {
    console.info('[Reconciler] no convs for account', accountId);
    return;
  }

  const mapJidToConvId = {};
  const convLastSynced = {};
  convs.forEach(c => {
    if (c.jid) mapJidToConvId[c.jid] = c.id;
    convLastSynced[c.id] = c.last_synced_at ? new Date(c.last_synced_at).getTime() : 0;
  });

  // state
  const collectedMaxTs = {};
  convs.forEach(c => collectedMaxTs[c.id] = convLastSynced[c.id] || 0);
  let lastActivity = Date.now();
  let running = true;

  // handler for messages.upsert
  const handler = async (payload) => {
    try {
      const msgs = payload.messages || [];
      if (!msgs.length) return;
      const relevant = msgs.filter(m => {
        const remote = m.key?.remoteJid || m.key?.participant || null;
        return remote && mapJidToConvId[remote];
      });
      if (!relevant.length) return;
      const maxTs = await processBaileysMessagesBatch(relevant, mapJidToConvId);
      // update collectedMaxTs per conv
      for (const m of relevant) {
        const remote = m.key?.remoteJid || m.key?.participant || null;
        const convId = mapJidToConvId[remote];
        let ts = null;
        if (m.messageTimestamp) ts = Number(m.messageTimestamp) * 1000;
        if (ts && ts > collectedMaxTs[convId]) collectedMaxTs[convId] = ts;
      }
      lastActivity = Date.now();
    } catch (e) {
      console.error('[Reconciler] handler error', e?.message || e);
    }
  };

  // attach handler
  sock.ev.on('messages.upsert', handler);

  // optional: explicit fetch per conversation if sock provides method
  if (typeof sock.fetchMessages === 'function') {
    for (const conv of convs) {
      try {
        const since = conv.last_synced_at ? new Date(conv.last_synced_at).getTime() : 0;
        const batch = await sock.fetchMessages(conv.jid, { since, limit: 200 });
        if (Array.isArray(batch) && batch.length) {
          await processBaileysMessagesBatch(batch, mapJidToConvId);
          // update collectedMaxTs
          for (const m of batch) {
            let ts = null;
            if (m.messageTimestamp) ts = Number(m.messageTimestamp) * 1000;
            if (ts && ts > collectedMaxTs[conv.id]) collectedMaxTs[conv.id] = ts;
          }
          lastActivity = Date.now();
        }
      } catch (e) {
        console.debug('[Reconciler] fetchMessages error or not supported', e?.message || e);
      }
    }
  }

  // wait loop
  const start = Date.now();
  while (running) {
    await new Promise(r => setTimeout(r, 1000));
    if ((Date.now() - start) > TIMEOUT_MS) running = false;
    else if ((Date.now() - lastActivity) > INACTIVITY_MS && (Date.now() - start) > 3000) running = false;
  }

  // remove handler
  try {
    sock.ev.removeListener('messages.upsert', handler);
  } catch (e) {
    console.warn('[Reconciler] removeListener error', e?.message || e);
  }

  // update last_synced_at
  for (const convId of Object.keys(collectedMaxTs)) {
    try {
      const ts = collectedMaxTs[convId];
      if (ts && ts > (convLastSynced[convId] || 0)) {
        await serverSupabase
          .from('conversations')
          .update({ last_synced_at: new Date(ts).toISOString() })
          .eq('id', convId);
      }
    } catch (e) {
      console.error('[Reconciler] update last_synced_at error', convId, e?.message || e);
    }
  }

  console.info(`[Reconciler] done for account=${accountId}`);
}
