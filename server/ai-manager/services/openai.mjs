/**
 * services/openai.mjs
 * Wrapper pentru OpenAI structured output.
 * Returnează întotdeauna un obiect structurat.
 */

import OpenAI from 'openai';
import { config } from '../config/config.mjs';

const client = new OpenAI({ apiKey: config.openai.apiKey });

/**
 * AI analyze-event schema (structured output via JSON mode).
 * Compatible cu gpt-4o-mini și gpt-4o.
 */
const ANALYZE_EVENT_SCHEMA = {
  name: 'analyze_event',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      event_type: {
        type: 'string',
        enum: [
          'inquiry',
          'booking_request',
          'complaint',
          'confirmation',
          'cancellation',
          'payment_request',
          'support',
          'missed_call_followup',
          'employee_report',
          'driver_report',
          'unknown',
        ],
      },
      intent: { type: 'string' },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      summary: { type: 'string' },
      next_action: { type: 'string' },
      suggested_reply: { type: 'string' },
      should_create_task: { type: 'boolean' },
      suggested_task_payload: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          assigned_to: { type: 'string' },
          due_date: { type: 'string' },
        },
        required: ['title', 'description', 'assigned_to', 'due_date'],
        additionalProperties: false,
      },
      should_escalate_to_human: { type: 'boolean' },
      confidence: { type: 'number' },
      evidence_needed: {
        type: 'array',
        items: { type: 'string' },
      },
      policy_flags: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: [
      'event_type',
      'intent',
      'priority',
      'summary',
      'next_action',
      'suggested_reply',
      'should_create_task',
      'suggested_task_payload',
      'should_escalate_to_human',
      'confidence',
      'evidence_needed',
      'policy_flags',
    ],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `You are Superparty AI Manager — the operational manager for a party/events company in Romania.
Your role is to analyze incoming messages (WhatsApp, Voice, App) and extract structured operational information.
You always respond in a structured JSON format. You are decisive but conservative.
When in doubt, escalate to human. Never fabricate data. Use Romanian context for names, dates, locations.
Currency is RON. Language context is Romanian.`;

/**
 * Analyzes a WhatsApp/Voice/App event and returns structured output.
 *
 * @param {object} payload
 * @param {string} payload.source         - "whatsapp" | "voice" | "app"
 * @param {string} [payload.conversationId]
 * @param {string} [payload.messageText]
 * @param {string} [payload.callSid]
 * @param {string} [payload.callerNumber]
 * @param {string} [payload.context]      - extra context from DB (client name, previous events, etc.)
 * @returns {{ result: object, model: string, tokensUsed: number, latencyMs: number }}
 */
export async function analyzeEvent(payload) {
  const start = Date.now();

  const userContent = buildUserPrompt(payload);

  const completion = await client.chat.completions.create({
    model: config.openai.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: ANALYZE_EVENT_SCHEMA,
    },
    temperature: 0.1,
    max_tokens: 1000,
  });

  const latencyMs = Date.now() - start;
  const raw = completion.choices[0]?.message?.content ?? '{}';
  const result = JSON.parse(raw);
  const tokensUsed = completion.usage?.total_tokens ?? 0;

  return {
    result,
    model: completion.model,
    tokensUsed,
    latencyMs,
  };
}

function buildUserPrompt(payload) {
  const lines = [`SOURCE: ${payload.source}`];

  if (payload.conversationId) lines.push(`CONVERSATION_ID: ${payload.conversationId}`);
  if (payload.callSid) lines.push(`CALL_SID: ${payload.callSid}`);
  if (payload.callerNumber) lines.push(`CALLER: ${payload.callerNumber}`);
  if (payload.messageText) lines.push(`MESSAGE:\n"""${payload.messageText}"""`);
  if (payload.context) lines.push(`CONTEXT:\n"""${payload.context}"""`);

  lines.push(`TIMESTAMP: ${new Date().toISOString()}`);

  return lines.join('\n');
}
