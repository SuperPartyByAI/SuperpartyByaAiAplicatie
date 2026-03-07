/**
 * routes/analyze.mjs
 * POST /ai/analyze-event — AI event analysis, local-first.
 *
 * Uses provider-router which defaults to local Ollama LLM.
 * OpenAI is optional fallback only (FALLBACK_PROVIDER=openai).
 */

import { Router } from 'express';
import { routeAnalyzeEvent } from '../services/providers/provider-router.mjs';
import { applyPolicy } from '../services/policy.mjs';
import { insertRow } from '../services/supabase.mjs';
import { writeAuditLog } from '../services/audit.mjs';
import { analyzeEventCounter } from './health.mjs';

const router = Router();

/**
 * POST /ai/analyze-event
 *
 * Body:
 * {
 *   source: "whatsapp" | "voice" | "app",
 *   conversationId?: string,
 *   messageText?: string,
 *   callSid?: string,
 *   callerNumber?: string,
 *   clientIdentityId?: string,
 *   clientDisplayName?: string,
 *   context?: string,
 * }
 */
router.post('/analyze-event', async (req, res) => {
  const start = Date.now();
  const {
    source,
    conversationId,
    messageText,
    callSid,
    callerNumber,
    clientIdentityId,
    clientDisplayName,
    context,
  } = req.body;

  if (!source) {
    return res.status(400).json({ error: 'source is required (whatsapp|voice|app)' });
  }

  try {
    // 1. Route to AI provider (local-first by default)
    const { result: rawResult, model, tokensUsed, latencyMs } = await routeAnalyzeEvent({
      source,
      conversationId,
      messageText,
      callSid,
      callerNumber,
      context,
    });

    // 2. Apply business policy rules
    const result = applyPolicy(rawResult);

    // 3. Persist ai_event (best-effort — table may not exist yet)
    let eventId = null;
    try {
      const eventRow = await insertRow('ai_events', {
        source_type: source,
        source_id: conversationId ?? callSid ?? null,
        conversation_id: conversationId ?? null,
        call_sid: callSid ?? null,
        client_identity_id: clientIdentityId ?? null,
        client_display_name: clientDisplayName ?? null,
        event_type: result.event_type,
        event_status: result.should_escalate_to_human ? 'needs_review' : 'proposed',
        summary: result.summary,
        details_json: result,
        ai_confidence: result.confidence,
        ai_suggested_next_action: result.next_action,
        human_review_status: 'pending',
        created_by_ai: true,
      });
      eventId = eventRow.id;
    } catch (dbErr) {
      req.log?.warn({ err: dbErr }, '[analyze-event] DB persist failed — migrations may be missing');
    }

    // 4. Write audit log (best-effort)
    await writeAuditLog({
      eventId,
      action: 'analyze_event',
      inputPayload: { source, conversationId, callSid, clientIdentityId },
      outputPayload: result,
      modelUsed: model,
      tokensUsed,
      latencyMs,
    });

    // 5. Metrics
    analyzeEventCounter.labels('success').inc();

    return res.json({
      ok: true,
      event_id: eventId,
      analysis: result,
      provider: model,
      latency_ms: Date.now() - start,
    });
  } catch (err) {
    analyzeEventCounter.labels('error').inc();

    await writeAuditLog({
      action: 'analyze_event',
      inputPayload: { source, conversationId, callSid },
      error: err.message,
    });

    req.log?.error({ err }, '[analyze-event] Failed');
    return res.status(500).json({ error: 'AI analysis failed', details: err.message });
  }
});

export default router;
