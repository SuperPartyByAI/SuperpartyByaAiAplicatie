/**
 * services/audit.mjs
 * Saves every AI action to ai_audit_log.
 * Called after analyze, trip actions, contestation updates, etc.
 */

import { insertRow } from './supabase.mjs';
import { logger } from '../index.mjs';

/**
 * @param {object} params
 * @param {string|null} params.eventId       - ai_events.id (FK)
 * @param {string}      params.action        - e.g. "analyze_event", "trip_start", "contestation_resolve"
 * @param {object}      params.inputPayload  - raw input
 * @param {object}      params.outputPayload - what the AI returned
 * @param {string}      [params.modelUsed]   - e.g. "gpt-4o-mini"
 * @param {number}      [params.tokensUsed]
 * @param {number}      [params.latencyMs]
 * @param {string}      [params.error]       - if errored
 */
export async function writeAuditLog({
  eventId = null,
  action,
  inputPayload = {},
  outputPayload = {},
  modelUsed = null,
  tokensUsed = null,
  latencyMs = null,
  error = null,
}) {
  try {
    await insertRow('ai_audit_log', {
      event_id: eventId,
      action,
      input_payload: inputPayload,
      output_payload: outputPayload,
      model_used: modelUsed,
      tokens_used: tokensUsed,
      latency_ms: latencyMs,
      error,
    });
  } catch (err) {
    // Audit log failure must NOT crash the main flow — log only
    logger?.warn({ err, action }, '[audit] Failed to write audit log');
  }
}
