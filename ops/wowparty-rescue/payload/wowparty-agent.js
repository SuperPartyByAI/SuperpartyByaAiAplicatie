'use strict';

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const crypto = require('crypto');
const { StateGraph, Annotation, MemorySaver } = require('@langchain/langgraph');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { z } = require('zod');
const supabase = require('../supabase');

const AGENT_VERSION = 'wowparty-events-v3';
const PROMPT_VERSION = 'booking-natural-language-v3';
const AI_TIMEOUT_MS = Number(process.env.WOWPARTY_AI_TIMEOUT_MS || 45000);
const MAX_CONTEXT_CHARS = Number(process.env.WOWPARTY_MAX_CONTEXT_CHARS || 90000);

const WA_OUTBOUND_ENABLED = process.env.WA_OUTBOUND_ENABLED === 'true';
if (WA_OUTBOUND_ENABLED) {
  throw new Error('WA_OUTBOUND_ENABLED=true is forbidden for the WowParty booking agent');
}

const AI_KEY =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
  process.env.GOOGLE_API_KEY;
const genai = AI_KEY ? new GoogleGenerativeAI(AI_KEY) : null;

const nullableText = z.string().trim().max(4000).nullable().optional();
const nullableNumber = z.coerce.number().finite().nullable().optional();

const ExtractionSchema = z.object({
  intent: z.enum([
    'booking_create',
    'booking_update',
    'booking_reschedule',
    'booking_cancel',
    'needs_internal_review',
    'no_event',
  ]),
  confidence: z.coerce.number().min(0).max(1),
  booking_agreed: z.boolean().optional().default(false),
  separate_new_event: z.boolean().optional().default(false),
  summary_nou: z.string().max(12000).optional().default(''),
  event_date: nullableText,
  event_time: nullableText,
  event_location: nullableText,
  client_name: nullableText,
  client_phone: nullableText,
  birthday_person: nullableText,
  birthday_age: nullableNumber,
  event_type: z.enum([
    'birthday',
    'school',
    'private_party',
    'corporate_kids',
    'other',
    'petrecere_copii',
    'corporate',
    'alta',
  ]).nullable().optional(),
  services: z.array(z.string().trim().min(1).max(300)).max(50).nullable().optional(),
  characters: z.array(z.string().trim().min(1).max(300)).max(50).nullable().optional(),
  price_agreed: nullableNumber,
  factual_notes: nullableText,
  target_event_hint: nullableText,
  internal_review_reason: nullableText,
  cancel_reason: nullableText,
}).strip();

const BookingState = Annotation.Root({
  job_id: Annotation({ reducer: (_, value) => value, default: () => null }),
  session_id: Annotation({ reducer: (_, value) => value, default: () => null }),
  business_id: Annotation({ reducer: (_, value) => value, default: () => null }),
  conversation_id: Annotation({ reducer: (_, value) => value, default: () => null }),
  trigger_message_id: Annotation({ reducer: (_, value) => value, default: () => null }),
  messages: Annotation({ reducer: (_, value) => value, default: () => [] }),
  existing_events: Annotation({ reducer: (_, value) => value, default: () => [] }),
  extracted_facts: Annotation({ reducer: (_, value) => value, default: () => ({}) }),
  intent: Annotation({ reducer: (_, value) => value, default: () => 'no_event' }),
  target_event_id: Annotation({ reducer: (_, value) => value, default: () => null }),
  decision: Annotation({ reducer: (_, value) => value, default: () => ({ action: 'no_event', confidence: 0 }) }),
  completed: Annotation({ reducer: (_, value) => value, default: () => false }),
  summary: Annotation({ reducer: (_, value) => value, default: () => '' }),
});

let checkpointer;
let compiledAgent;

function cleanText(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned ? cleaned : null;
}

function cleanDate(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const match = cleaned.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function cleanTime(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const match = cleaned.match(/(?:^|\s)([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?:\s|$)/);
  return match ? `${match[1]}:${match[2]}` : null;
}

function cleanList(value) {
  if (!Array.isArray(value)) return null;
  const unique = [...new Set(value.map(cleanText).filter(Boolean))];
  return unique.length ? unique : null;
}

function normalizeFacts(raw) {
  const parsed = ExtractionSchema.parse(raw);
  return {
    ...parsed,
    event_date: cleanDate(parsed.event_date),
    event_time: cleanTime(parsed.event_time),
    event_location: cleanText(parsed.event_location),
    client_name: cleanText(parsed.client_name),
    client_phone: cleanText(parsed.client_phone),
    birthday_person: cleanText(parsed.birthday_person),
    birthday_age: parsed.birthday_age === null || parsed.birthday_age === undefined
      ? null
      : Math.max(0, Math.round(parsed.birthday_age)),
    event_type: cleanText(parsed.event_type),
    services: cleanList(parsed.services),
    characters: cleanList(parsed.characters),
    price_agreed: parsed.price_agreed === null || parsed.price_agreed === undefined
      ? null
      : Math.max(0, parsed.price_agreed),
    factual_notes: cleanText(parsed.factual_notes),
    target_event_hint: cleanText(parsed.target_event_hint),
    internal_review_reason: cleanText(parsed.internal_review_reason),
    cancel_reason: cleanText(parsed.cancel_reason),
  };
}

function eventDataFromFacts(facts) {
  const allowed = [
    'event_date',
    'event_time',
    'event_location',
    'client_name',
    'client_phone',
    'birthday_person',
    'birthday_age',
    'event_type',
    'services',
    'characters',
    'price_agreed',
    'factual_notes',
  ];
  const data = {};
  for (const key of allowed) {
    const value = facts[key];
    if (value !== null && value !== undefined && value !== '') data[key] = value;
  }
  return data;
}

function valuesEqual(first, second) {
  if (Array.isArray(first) || Array.isArray(second)) {
    if (!Array.isArray(first) || !Array.isArray(second)) return false;
    return JSON.stringify(first) === JSON.stringify(second);
  }
  if (first === null || first === undefined || second === null || second === undefined) {
    return first === second;
  }
  if (typeof first === 'number' || typeof second === 'number') {
    return Number(first) === Number(second);
  }
  return String(first) === String(second);
}

function changedEventData(data, existingEvent) {
  if (!existingEvent) return data;
  const changed = {};
  for (const [key, value] of Object.entries(data)) {
    let existing = existingEvent[key];
    if (key === 'event_time' && typeof existing === 'string') existing = existing.slice(0, 5);
    if (key === 'event_date' && typeof existing === 'string') existing = existing.slice(0, 10);
    if (!valuesEqual(value, existing)) changed[key] = value;
  }
  return changed;
}

function compactConversation(messages) {
  const rendered = messages.map((message) => {
    const actor = message.direction === 'inbound' ? 'Client' : 'Operator';
    const content = cleanText(message.content) || `[${message.message_type || 'media'}]`;
    return `[${message.created_at || ''}] [${actor}] ${content}`;
  });

  let used = 0;
  const selected = [];
  for (let index = rendered.length - 1; index >= 0; index -= 1) {
    const line = rendered[index];
    if (used + line.length > MAX_CONTEXT_CHARS) break;
    selected.push(line);
    used += line.length;
  }
  selected.reverse();
  if (selected.length < rendered.length) {
    selected.unshift(`[Context anterior omis tehnic: ${rendered.length - selected.length} mesaje. Folosește evenimentele existente drept stare canonică.]`);
  }
  return selected.join('\n');
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout_${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function deterministicUuid(seed) {
  const bytes = crypto.createHash('sha256').update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isMissingRpc(error) {
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return /PGRST202|could not find the function|function .* does not exist/i.test(text);
}

async function loadContext(state) {
  const { conversation_id, business_id } = state;
  if (!conversation_id || !business_id) throw new Error('job_context_missing');

  const { data: messages, error: messageError } = await supabase
    .from('messages')
    .select('id,content,direction,created_at,message_type,conversation_id')
    .eq('conversation_id', conversation_id)
    .order('created_at', { ascending: true });
  if (messageError) throw new Error(`load_messages_failed:${messageError.message}`);

  const { data: events, error: eventError } = await supabase
    .from('events')
    .select('id,status,event_type,event_date,event_time,event_location,client_name,client_phone,birthday_person,birthday_age,services,characters,price_agreed,factual_notes,event_details,agent_confidence,created_at,updated_at,cancelled_at')
    .eq('conversation_id', conversation_id)
    .eq('business_id', business_id)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(20);
  if (eventError) throw new Error(`load_events_failed:${eventError.message}`);

  return { messages: messages || [], existing_events: events || [] };
}

async function extractFacts(state) {
  if (!state.messages.length) {
    return {
      intent: 'no_event',
      extracted_facts: normalizeFacts({ intent: 'no_event', confidence: 1, booking_agreed: false }),
    };
  }
  if (!genai) throw new Error('gemini_api_key_missing');

  const existingEvents = state.existing_events.length
    ? state.existing_events.map((event) => JSON.stringify({
        id: event.id,
        status: event.status,
        event_date: event.event_date,
        event_time: event.event_time,
        event_location: event.event_location,
        client_name: event.client_name,
        birthday_person: event.birthday_person,
        birthday_age: event.birthday_age,
        services: event.services,
        characters: event.characters,
        price_agreed: event.price_agreed,
      })).join('\n')
    : 'Niciun eveniment activ.';

  const now = new Intl.DateTimeFormat('ro-RO', {
    timeZone: 'Europe/Bucharest',
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(new Date());

  const prompt = `Analizezi conversația WhatsApp a unei firme de petreceri pentru copii și actualizezi agenda internă. Nu răspunzi clientului și nu generezi mesaje WhatsApp.

Moment curent: ${now}, fus Europe/Bucharest.

Regula principală: înțelege acordul din limbaj natural. O rezervare poate fi făcută fără cuvântul „confirm”, dacă din ansamblul conversației reiese clar că părțile au stabilit petrecerea. O simplă întrebare despre preț, disponibilitate sau ofertă NU este rezervare.

Intenții:
- booking_create: conversația stabilește clar o rezervare nouă. booking_agreed trebuie să fie true.
- booking_update: clientul/operatorul schimbă date ale unei rezervări existente.
- booking_reschedule: schimbă data sau ora unei rezervări existente.
- booking_cancel: anulare explicită a unei rezervări existente.
- needs_internal_review: există mai multe evenimente posibile și nu poți identifica sigur ținta.
- no_event: discuție generală, cerere de ofertă, informație incompletă sau niciun fapt nou pentru agendă.

Reguli obligatorii:
- Nu inventa date. Câmpurile necunoscute sunt null.
- Nu extrage și nu urmări avans/depozit.
- Dacă un eveniment existent reprezintă deja aceeași petrecere și mesajele nu schimbă nimic, folosește no_event, nu booking_create.
- Dacă există un eveniment și este schimbat, folosește booking_update/booking_reschedule.
- Dacă există deja evenimente, booking_create este permis doar pentru o petrecere distinctă; setează separate_new_event=true.
- target_event_hint poate fi doar unul dintre ID-urile furnizate mai jos.
- event_date este YYYY-MM-DD; event_time este HH:MM, în Europe/Bucharest.
- event_type este exclusiv una dintre valorile: birthday, school, private_party, corporate_kids, other, petrecere_copii, corporate, alta. Pentru o petrecere de copii fără un tip mai precis folosește petrecere_copii.
- price_agreed este doar prețul final explicit acceptat, altfel null.

Evenimente active canonice:
${existingEvents}

Conversație:
${compactConversation(state.messages)}

Returnează exclusiv JSON cu cheile:
intent, confidence, booking_agreed, separate_new_event, summary_nou, event_date, event_time, event_location, client_name, client_phone, birthday_person, birthday_age, event_type, services, characters, price_agreed, factual_notes, target_event_hint, internal_review_reason, cancel_reason.`;

  const model = genai.getGenerativeModel({ model: process.env.WOWPARTY_GEMINI_MODEL || 'gemini-2.5-pro' });
  const response = await withTimeout(
    model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
    AI_TIMEOUT_MS,
    'gemini',
  );

  const rawText = response.response.text().trim();
  let rawFacts;
  try {
    rawFacts = JSON.parse(rawText);
  } catch (error) {
    throw new Error(`gemini_invalid_json:${error.message}`);
  }
  const facts = normalizeFacts(rawFacts);
  return { extracted_facts: facts, intent: facts.intent, summary: facts.summary_nou || state.summary };
}

async function identifyTarget(state) {
  const targetIntents = new Set(['booking_update', 'booking_reschedule', 'booking_cancel']);
  if (!targetIntents.has(state.intent)) return { target_event_id: null };

  const hinted = state.extracted_facts.target_event_hint;
  if (hinted && state.existing_events.some((event) => event.id === hinted)) {
    return { target_event_id: hinted };
  }
  if (state.existing_events.length === 1) return { target_event_id: state.existing_events[0].id };
  if (state.existing_events.length > 1) {
    return {
      target_event_id: null,
      intent: 'needs_internal_review',
      extracted_facts: {
        ...state.extracted_facts,
        intent: 'needs_internal_review',
        internal_review_reason: state.extracted_facts.internal_review_reason || 'Nu se poate identifica sigur evenimentul vizat.',
      },
    };
  }
  return { target_event_id: null };
}

async function decideAction(state) {
  const facts = state.extracted_facts;
  const confidence = facts.confidence || 0;

  if (state.intent === 'needs_internal_review') {
    return {
      decision: {
        action: 'needs_internal_review',
        confidence,
        reason: facts.internal_review_reason,
        candidate_events: state.existing_events.map((event) => event.id),
      },
    };
  }
  if (state.intent === 'booking_create') {
    return { decision: { action: 'booking_create', confidence, event_data: eventDataFromFacts(facts) } };
  }
  if (state.intent === 'booking_update' || state.intent === 'booking_reschedule') {
    const existingEvent = state.existing_events.find((event) => event.id === state.target_event_id);
    const eventData = changedEventData(eventDataFromFacts(facts), existingEvent);
    const action = state.intent === 'booking_reschedule'
      && !Object.prototype.hasOwnProperty.call(eventData, 'event_date')
      && !Object.prototype.hasOwnProperty.call(eventData, 'event_time')
      ? 'booking_update'
      : state.intent;
    return {
      decision: {
        action,
        confidence,
        event_id: state.target_event_id,
        event_data: eventData,
      },
    };
  }
  if (state.intent === 'booking_cancel') {
    return {
      decision: {
        action: 'booking_cancel',
        confidence,
        event_id: state.target_event_id,
        cancel_reason: facts.cancel_reason,
      },
    };
  }
  return { decision: { action: 'no_event', confidence } };
}

async function validateDecision(state) {
  const { decision, extracted_facts: facts, existing_events: events } = state;
  if (decision.action === 'no_event' || decision.action === 'needs_internal_review') return {};

  if ((decision.confidence || 0) < 0.65) {
    return { decision: { action: 'no_event', confidence: decision.confidence || 0, reason: 'low_confidence' } };
  }
  if (decision.action === 'booking_create') {
    const data = decision.event_data || {};
    const hasConcreteFact = Boolean(
      data.event_date || data.birthday_person || (data.event_time && data.event_location),
    );
    if (!facts.booking_agreed || !hasConcreteFact) {
      return { decision: { action: 'no_event', confidence: decision.confidence, reason: 'booking_not_established' } };
    }
    if (events.length > 0 && !facts.separate_new_event) {
      return { decision: { action: 'no_event', confidence: decision.confidence, reason: 'existing_event_not_new' } };
    }
  }
  if (['booking_update', 'booking_reschedule', 'booking_cancel'].includes(decision.action) && !decision.event_id) {
    return { decision: { action: 'no_event', confidence: decision.confidence, reason: 'target_event_missing' } };
  }
  if (['booking_update', 'booking_reschedule'].includes(decision.action) && Object.keys(decision.event_data || {}).length === 0) {
    return { decision: { action: 'no_event', confidence: decision.confidence, reason: 'no_changed_fields' } };
  }
  return {};
}

function rpcAction(action) {
  if (action === 'booking_create') return 'create';
  if (action === 'booking_update' || action === 'booking_reschedule') return 'update';
  if (action === 'booking_cancel') return 'cancel';
  return 'no_op';
}

async function persistWithRpc(state) {
  const decision = state.decision;
  const { data, error } = await supabase.rpc('persist_agent_decision_atomic', {
    p_action: rpcAction(decision.action),
    p_session_id: state.session_id,
    p_business_id: state.business_id,
    p_conversation_id: state.conversation_id,
    p_job_id: state.job_id,
    p_trigger_message_id: state.trigger_message_id || null,
    p_confidence: decision.confidence || 0,
    p_decision: decision,
    p_extracted_facts: state.extracted_facts || {},
    p_event_id: decision.event_id || null,
    p_event_data: decision.event_data || {},
    p_cancel_reason: decision.cancel_reason || null,
    p_rescheduled: decision.action === 'booking_reschedule',
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.final_event_id || decision.event_id || null;
}

async function persist(state) {
  let eventId = null;
  try {
    eventId = await persistWithRpc(state);
  } catch (error) {
    if (isMissingRpc(error)) throw new Error('atomic_persist_rpc_missing');
    throw new Error(`atomic_persist_failed:${error.message}`);
  }
  return { completed: true, decision: { ...state.decision, event_id: eventId || state.decision.event_id || null } };
}

async function buildAgent() {
  const graph = new StateGraph(BookingState)
    .addNode('load_context', loadContext)
    .addNode('extract_facts', extractFacts)
    .addNode('identify_target', identifyTarget)
    .addNode('decide_action', decideAction)
    .addNode('validate', validateDecision)
    .addNode('persist', persist);

  graph.setEntryPoint('load_context');
  graph.addEdge('load_context', 'extract_facts');
  graph.addEdge('extract_facts', 'identify_target');
  graph.addEdge('identify_target', 'decide_action');
  graph.addEdge('decide_action', 'validate');
  graph.addEdge('validate', 'persist');
  graph.addEdge('persist', '__end__');

  if (!checkpointer) checkpointer = new MemorySaver();
  return graph.compile({ checkpointer });
}

async function getAgent() {
  if (!compiledAgent) compiledAgent = await buildAgent();
  return compiledAgent;
}

async function processJob(job) {
  const required = ['id', 'session_id', 'business_id', 'conversation_id'];
  for (const field of required) {
    if (!job?.[field]) throw new Error(`job_${field}_missing`);
  }

  const agent = await getAgent();
  const threadId = job.id;
  const finalState = await agent.invoke({
    job_id: job.id,
    session_id: job.session_id,
    business_id: job.business_id,
    conversation_id: job.conversation_id,
    trigger_message_id: job.trigger_message_id || null,
  }, { configurable: { thread_id: threadId } });

  if (!finalState.completed) throw new Error('job_not_persisted');
  return { success: true, action: finalState.decision?.action || 'no_event' };
}

async function shutdown() {
  compiledAgent = null;
  checkpointer = null;
}

module.exports = {
  processJob,
  buildAgent,
  getAgent,
  shutdown,
  normalizeFacts,
  eventDataFromFacts,
  changedEventData,
  validateDecision,
  deterministicUuid,
};
