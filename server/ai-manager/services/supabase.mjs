/**
 * services/supabase.mjs
 * Supabase client singleton for AI Manager.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from '../config/config.mjs';

export const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceKey,
  {
    auth: { persistSession: false },
    global: { headers: { 'x-application': 'superparty-ai-manager' } },
  }
);

/**
 * Thin query helpers — always throw on error.
 */

export async function insertRow(table, row) {
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) throw Object.assign(new Error(`[supabase] insert ${table}: ${error.message}`), { cause: error });
  return data;
}

export async function updateRow(table, id, patch) {
  const { data, error } = await supabase
    .from(table)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw Object.assign(new Error(`[supabase] update ${table}: ${error.message}`), { cause: error });
  return data;
}

export async function getRow(table, id) {
  const { data, error } = await supabase.from(table).select('*').eq('id', id).single();
  if (error) throw Object.assign(new Error(`[supabase] get ${table}: ${error.message}`), { cause: error });
  return data;
}

export async function queryRows(table, filters = {}, { limit = 50, orderBy = 'created_at', ascending = false } = {}) {
  let q = supabase.from(table).select('*').order(orderBy, { ascending }).limit(limit);
  for (const [key, val] of Object.entries(filters)) {
    q = q.eq(key, val);
  }
  const { data, error } = await q;
  if (error) throw Object.assign(new Error(`[supabase] query ${table}: ${error.message}`), { cause: error });
  return data;
}
