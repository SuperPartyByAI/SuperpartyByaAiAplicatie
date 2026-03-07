/**
 * services/providers/local-llm.mjs
 * Local LLM provider via Ollama (CPU-first, no GPU required).
 *
 * Model recommendation for CX33 (4 vCPU, 8 GB RAM):
 *   - llama3.2:1b  (~800 MB, ~3-8s/req)   — fast, good for classification
 *   - phi3.5:mini  (~2.2 GB, ~5-15s/req)  — better reasoning
 *   - gemma2:2b    (~1.6 GB, ~4-12s/req)  — multilingual (Romanian)
 *
 * Performance is honest:
 * - 3-15 seconds per request on CPU
 * - suitable for async/background use
 * - NOT suitable for real-time voice latency
 */

import { config } from '../../config/config.mjs';

const SYSTEM_PROMPT = `Ești Superparty AI Manager — managerul operațional al unei firme de animatori și evenimente în România.
Analizezi mesaje primite (WhatsApp, voce, aplicație) și extragi informații operaționale structurate.
Răspunzi ÎNTOTDEAUNA în format JSON pur valid. Fii conservator și escaladează la om când ești nesigur.
Nu inventa date. Valuta este RON. Contextul lingvistic este românesc.`;

/**
 * Analyze an event using local Ollama LLM.
 * @param {object} payload
 * @returns {{ result: object, model: string, tokensUsed: number, latencyMs: number }}
 */
export async function analyzeEventLocal(payload) {
  const start = Date.now();
  const model = config.ai.localLlmModel;
  const baseUrl = config.ai.localLlmUrl;

  const userContent = buildUserPrompt(payload);

  const requestBody = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent + '\n\nRăspunde DOAR cu un obiect JSON valid, fără text suplimentar.' },
    ],
    stream: false,
    format: 'json',
    options: {
      temperature: 0.1,
      num_predict: 800,
    },
  };

  let raw;
  try {
    const resp = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(60_000), // 60s max for CPU inference
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Ollama ${resp.status}: ${body.slice(0, 200)}`);
    }

    const json = await resp.json();
    raw = json.message?.content ?? '{}';
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error('Local LLM timeout (60s) — model may be loading or overloaded');
    }
    throw err;
  }

  const latencyMs = Date.now() - start;
  const result = parseAndNormalize(raw, payload);

  return {
    result,
    model: `ollama:${model}`,
    tokensUsed: 0, // Ollama doesn't return token count in all versions
    latencyMs,
  };
}

/**
 * Parse JSON from LLM output, normalize missing fields with safe defaults.
 * Local models sometimes produce slightly off JSON — we are defensive.
 */
function parseAndNormalize(raw, payload) {
  let parsed;

  try {
    // Try to extract JSON even if model added text around it
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : raw);
  } catch {
    // Fallback: return structured stub if JSON parsing fails
    parsed = buildFallbackResult(payload, 'json_parse_error');
  }

  return normalizeResult(parsed, payload);
}

function normalizeResult(parsed, payload) {
  const text = payload.messageText ?? '';
  const textLower = text.toLowerCase();

  return {
    event_type: parsed.event_type ?? inferEventType(textLower),
    intent: parsed.intent ?? 'Intenție nedetectată de model local',
    priority: parsed.priority ?? 'medium',
    summary: parsed.summary ?? text.slice(0, 200),
    next_action: parsed.next_action ?? 'Verificare manuală recomandată',
    suggested_reply: parsed.suggested_reply ?? 'Bună ziua! Am primit mesajul dvs. și vă vom contacta curând.',
    should_create_task: parsed.should_create_task ?? false,
    suggested_task_payload: parsed.suggested_task_payload ?? {
      title: 'Verificare eveniment',
      description: text.slice(0, 100),
      assigned_to: 'echipa',
      due_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString().split('T')[0],
    },
    should_escalate_to_human: parsed.should_escalate_to_human ?? true,
    confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.6,
    evidence_needed: Array.isArray(parsed.evidence_needed) ? parsed.evidence_needed : [],
    policy_flags: Array.isArray(parsed.policy_flags) ? parsed.policy_flags : [],
  };
}

function inferEventType(textLower) {
  if (textLower.includes('rezerv') || textLower.includes('book') || textLower.includes('angaj')) return 'booking_request';
  if (textLower.includes('reclam') || textLower.includes('nemulțumit') || textLower.includes('plângere')) return 'complaint';
  if (textLower.includes('confirm') || textLower.includes('ok') || textLower.includes('da,')) return 'confirmation';
  if (textLower.includes('anulare') || textLower.includes('cancel') || textLower.includes('renunț')) return 'cancellation';
  if (textLower.includes('plată') || textLower.includes('factură') || textLower.includes('pret')) return 'payment_request';
  if (textLower.includes('raport') || textLower.includes('angajat') || textLower.includes('șofer')) return 'employee_report';
  return 'inquiry';
}

function buildFallbackResult(payload, reason) {
  return {
    event_type: 'unknown',
    intent: `Analiză locală eșuată: ${reason}`,
    priority: 'medium',
    summary: (payload.messageText ?? '').slice(0, 200),
    next_action: 'Revizuire manuală necesară',
    suggested_reply: 'Bună ziua! Am primit mesajul dvs. și vă vom contacta în curând.',
    should_create_task: false,
    suggested_task_payload: {
      title: 'Verificare manuală',
      description: 'Analiza automată a eșuat — verificare necesară',
      assigned_to: 'echipa',
      due_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString().split('T')[0],
    },
    should_escalate_to_human: true,
    confidence: 0.0,
    evidence_needed: ['verificare_manuala'],
    policy_flags: ['local_model_fallback'],
  };
}

function buildUserPrompt(payload) {
  const lines = [`SURSĂ: ${payload.source}`];
  if (payload.conversationId) lines.push(`ID_CONVERSAȚIE: ${payload.conversationId}`);
  if (payload.callSid) lines.push(`CALL_SID: ${payload.callSid}`);
  if (payload.callerNumber) lines.push(`APELANT: ${payload.callerNumber}`);
  if (payload.messageText) lines.push(`MESAJ:\n"""${payload.messageText}"""`);
  if (payload.context) lines.push(`CONTEXT:\n"""${payload.context}"""`);
  lines.push(`TIMESTAMP: ${new Date().toISOString()}`);

  lines.push(`\nReturnează JSON cu câmpurile:
event_type (inquiry/booking_request/complaint/confirmation/cancellation/payment_request/support/missed_call_followup/employee_report/driver_report/unknown),
intent (string), priority (low/medium/high/critical),
summary (string), next_action (string), suggested_reply (string),
should_create_task (boolean), suggested_task_payload ({title, description, assigned_to, due_date}),
should_escalate_to_human (boolean), confidence (0.0-1.0),
evidence_needed (array of strings), policy_flags (array of strings).`);

  return lines.join('\n');
}

/**
 * Check if Ollama is reachable and the model is available.
 * @returns {{ available: boolean, model: string, reason?: string }}
 */
export async function checkLocalLlm() {
  try {
    const resp = await fetch(`${config.ai.localLlmUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return { available: false, model: config.ai.localLlmModel, reason: `HTTP ${resp.status}` };
    const data = await resp.json();
    const models = data.models?.map((m) => m.name) ?? [];
    const found = models.some((m) => m.startsWith(config.ai.localLlmModel.split(':')[0]));
    return {
      available: found,
      model: config.ai.localLlmModel,
      installedModels: models,
      reason: found ? undefined : `Model ${config.ai.localLlmModel} not installed`,
    };
  } catch (err) {
    return { available: false, model: config.ai.localLlmModel, reason: err.message };
  }
}
