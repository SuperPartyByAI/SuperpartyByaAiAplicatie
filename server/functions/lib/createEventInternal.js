/**
 * Internal event creation logic shared between chatEventOps and chatWithAI
 * This function can be called directly without Firebase Callable overhead
 */

'use strict';

const admin = require('firebase-admin');
const { normalizeEventFields, normalizeRoleFields } = require('../normalizers');
const { getNextEventShortId, getNextFreeSlot } = require('./shortCodeGenerator');
const { getNextSequentialEventId } = require('./sequentialEventId');

// Init admin once
if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Default roles for events without specified roles
 */
function defaultRoles() {
  return [
    {
      type: 'ANIMATOR',
      startTime: '14:00',
      duration: 2,
      status: 'PENDING',
    },
  ];
}

/**
 * Create an event in Firestore
 * @param {Object} params - Event creation parameters
 * @param {Object} params.data - Event data (date, address, childName, etc.)
 * @param {string} params.uid - User ID creating the event
 * @param {string} params.email - User email
 * @param {string} params.staffCode - Staff code (if employee)
 * @param {string} [params.clientRequestId] - Optional idempotency key
 * @param {boolean} [params.dryRun=false] - If true, return preview without saving
 * @returns {Promise<Object>} Result with eventId and status
 */
async function createEventInternal(params) {
  const { data, uid, email, staffCode, clientRequestId, dryRun = false, imageUrl = null } = params;

  const db = admin.firestore();

  // VALIDATION: date and address are required
  const dateStr = String(data.date || '').trim();
  const addressStr = String(data.address || '').trim();

  if (!dateStr) {
    return {
      ok: false,
      message:
        'Lipsește data evenimentului. Te rog să specifici data în format DD-MM-YYYY (ex: 15-01-2026).',
    };
  }

  if (!addressStr) {
    return {
      ok: false,
      message:
        'Lipsește adresa evenimentului. Te rog să specifici locația (ex: București, Str. Exemplu 10).',
    };
  }

  // Validate date format (DD-MM-YYYY)
  const dateRegex = /^\d{2}-\d{2}-\d{4}$/;
  if (!dateRegex.test(dateStr)) {
    return {
      ok: false,
      message: `Data trebuie să fie în format DD-MM-YYYY (ex: 15-01-2026). Ai introdus: "${dateStr}"`,
    };
  }

  // Idempotency: check if event with this clientRequestId already exists
  if (clientRequestId && !dryRun) {
    const existingSnap = await db
      .collection('evenimente')
      .where('clientRequestId', '==', clientRequestId)
      .where('createdBy', '==', uid)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      const existingDoc = existingSnap.docs[0];
      return {
        ok: true,
        eventId: existingDoc.id,
        message: `Eveniment deja creat: ${existingDoc.id}`,
        idempotent: true,
      };
    }
  }

  const now = admin.firestore.FieldValue.serverTimestamp();

  // Normalize input to V3 EN schema
  const normalized = normalizeEventFields(data);

  // Generate sequential event ID (01, 02, 03...)
  const eventId = await getNextSequentialEventId();
  const eventShortId = await getNextEventShortId(); // Keep for slot generation

  // Convert roles[] to rolesBySlot if needed
  let rolesBySlot = normalized.rolesBySlot || {};
  if (Array.isArray(data.roles) && data.roles.length > 0) {
    rolesBySlot = {};
    for (let i = 0; i < data.roles.length; i++) {
      const slot = getNextFreeSlot(eventShortId, rolesBySlot);
      rolesBySlot[slot] = normalizeRoleFields(data.roles[i]);
    }
  } else if (Object.keys(rolesBySlot).length === 0) {
    // No roles provided, use default
    const defaultRole = defaultRoles()[0];
    const slot = getNextFreeSlot(eventShortId, {});
    rolesBySlot[slot] = normalizeRoleFields(defaultRole);
  }

  const doc = {
    schemaVersion: 3,
    eventShortId,
    date: String(normalized.date || '').trim(),
    address: String(normalized.address || '').trim(),
    phoneE164: normalized.phoneE164 || null,
    phoneRaw: normalized.phoneRaw || null,
    childName: String(normalized.childName || '').trim(),
    childAge: Number.isFinite(Number(normalized.childAge)) ? Number(normalized.childAge) : 0,
    childDob: normalized.childDob || null,
    parentName: normalized.parentName || null,
    parentPhone: normalized.parentPhone || null,
    numChildren: normalized.numChildren || null,
    payment: normalized.payment || { status: 'UNPAID', method: null, amount: 0 },
    rolesBySlot,
    isArchived: false,
    notedByCode: staffCode || null,
    createdAt: now,
    createdBy: uid,
    createdByEmail: email,
    updatedAt: now,
    updatedBy: uid,
    ...(clientRequestId ? { clientRequestId } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };

  if (!doc.date || !doc.address) {
    return {
      ok: false,
      message: 'CREATE necesită cel puțin date (DD-MM-YYYY) și address.',
    };
  }

  // DryRun: return preview without writing to Firestore
  if (dryRun) {
    return {
      ok: true,
      data: doc,
      eventId,
      eventShortId: doc.eventShortId,
      message: `Preview: Eveniment #${eventId} va fi creat cu aceste date`,
      dryRun: true,
    };
  }

  // Use sequential ID as document ID
  await db.collection('evenimente').doc(eventId).set(doc);
  return {
    ok: true,
    eventId,
    eventShortId: doc.eventShortId,
    message: `Eveniment #${eventId} creat și adăugat în Evenimente.`,
  };
}

module.exports = { createEventInternal };
