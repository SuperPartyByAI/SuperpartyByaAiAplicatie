'use strict';

/**
 * Chat Event Operations V2
 *
 * Enhanced version with:
 * - Interactive noting mode
 * - CREATE vs UPDATE logic
 * - Short codes
 * - Role detection with synonyms
 * - Role-specific logic (Animator, Ursitoare)
 * - AI interpretation logging
 * - Admin corrections
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { GoogleGenAI } = require('@google/genai');

// Import helper modules
const ConversationStateManager = require('./conversationStateManager');
const RoleDetector = require('./roleDetector');
const DateTimeParser = require('./dateTimeParser');
const EventIdentifier = require('./eventIdentifier');
const ShortCodeGenerator = require('./shortCodeGenerator');

// Define secret for GEMINI API key
const geminiApiKey = defineSecret('GEMINI_API_KEY');

// Super admin email
const SUPER_ADMIN_EMAIL = 'ursache.andrei1995@gmail.com';

// Get admin emails from environment
function getAdminEmails() {
  const envEmails = process.env.ADMIN_EMAILS || '';
  return envEmails
    .split(',')
    .map(e => e.trim())
    .filter(Boolean);
}

// Require authentication
function requireAuth(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Trebuie să fii autentificat.');
  }
  return {
    uid: request.auth.uid,
    email: request.auth.token?.email || '',
  };
}

// Check if user is employee
async function isEmployee(uid, email) {
  const adminEmails = [SUPER_ADMIN_EMAIL, ...getAdminEmails()];
  if (adminEmails.includes(email)) {
    return {
      isEmployee: true,
      role: 'admin',
      isGmOrAdmin: true,
      isSuperAdmin: email === SUPER_ADMIN_EMAIL,
    };
  }

  const db = admin.firestore();
  const staffSnap = await db.collection('employees').where('uid', '==', uid).limit(1).get();

  if (staffSnap.empty) {
    return {
      isEmployee: false,
      role: 'user',
      isGmOrAdmin: false,
      isSuperAdmin: false,
    };
  }

  const staffData = staffSnap.docs[0].data();
  const role = staffData?.role || 'staff';
  const isGmOrAdmin = ['gm', 'admin'].includes(role.toLowerCase());

  return {
    isEmployee: true,
    role,
    isGmOrAdmin,
    isSuperAdmin: false,
  };
}

// Check team_permissions for RBAC
async function hasEventNotingPermission(uid, isGmOrAdmin, isSuperAdmin) {
  if (isSuperAdmin || isGmOrAdmin) return true; // Admins ALWAYS have access

  const db = admin.firestore();
  const permSnap = await db.collection('employees').where('uid', '==', uid).limit(1).get();

  if (permSnap.empty) return false;

  const data = permSnap.docs[0].data();
  return data.canNoteEvents === true;
}

exports.chatEventOpsV2 = onCall(
  {
    region: 'europe-west1',
    enforceAppCheck: false,
    minInstances: 0,
    maxInstances: 3,
    timeoutSeconds: 180,
    memory: '256MiB',
    secrets: [geminiApiKey],
    serviceAccount: 'superparty-frontend@appspot.gserviceaccount.com',
  },
  async request => {
    const auth = requireAuth(request);
    const { uid, email } = auth;

    const employeeInfo = await isEmployee(uid, email);

    const text = (request.data?.text || '').toString().trim();
    if (!text) throw new HttpsError('invalid-argument', 'Lipsește "text".');

    const sessionId = request.data?.sessionId || `session_${uid}_${Date.now()}`;
    const dryRun = request.data?.dryRun === true;

    const db = admin.firestore();

    // Initialize helper modules
    const stateManager = new ConversationStateManager(db);
    const roleDetector = new RoleDetector(db);
    const dateTimeParser = new DateTimeParser();
    const eventIdentifier = new EventIdentifier(db);
    const shortCodeGenerator = new ShortCodeGenerator(db);

    // Get current conversation state
    let conversationState = await stateManager.getState(sessionId);

    // Check for cancel/exit commands
    const cancelKeywords = ['anuleaza', 'anulează', 'cancel', 'stop', 'iesi', 'ieși'];
    const normalizedText = text
      .toLowerCase()
      .replace(/ă/g, 'a')
      .replace(/â/g, 'a')
      .replace(/î/g, 'i')
      .replace(/ș/g, 's')
      .replace(/ț/g, 't');

    if (cancelKeywords.some(kw => normalizedText.includes(kw))) {
      if (conversationState && conversationState.notingMode) {
        await stateManager.cancelNotingMode(sessionId);
        return {
          ok: true,
          action: 'CANCELLED',
          message: '✅ Am anulat notarea evenimentului. Cu ce te pot ajuta?',
        };
      }
    }

    // RBAC Security Gate
    const hasPermission = await hasEventNotingPermission(
      uid,
      employeeInfo.isGmOrAdmin,
      employeeInfo.isSuperAdmin
    );

    // If user is already in noting mode but just got their rights revoked
    if (conversationState && conversationState.notingMode && !hasPermission) {
      await stateManager.cancelNotingMode(sessionId);
      return {
        ok: false,
        action: 'NONE',
        message: '⚠️ Permisiunea ta de a nota evenimente a fost revocată. Sesiunea a fost anulată.',
        raw: '',
      };
    }

    // ════════════════════════════════════════════
    // SAVE NOW — Direct create from session state (bypasses AI)
    // ════════════════════════════════════════════
    const saveNow = request.data?.saveNow === true;
    if (saveNow) {
      if (!hasPermission) {
        return { ok: false, action: 'NONE', message: '⚠️ Nu ai permisiunea de a crea evenimente.' };
      }

      // Get draft from conversation state
      const draft = conversationState?.draftEvent || {};
      console.log('[SAVE_NOW] Draft from session:', JSON.stringify(draft, null, 2));

      if (!draft || Object.keys(draft).length === 0) {
        return { ok: false, action: 'NONE', message: '⚠️ Nu există date de salvat. Extrage mai întâi un formular.' };
      }

      // Generate sequential short code (01, 02, 03...)
      const shortCode = await shortCodeGenerator.generateEventShortCode();
      console.log('[SAVE_NOW] Generated shortCode:', shortCode);

      // Process rolesDraft into roles with slot codes
      const rolesDraft = draft.rolesDraft || [];
      const expandedRoles = [];

      for (const roleDraft of rolesDraft) {
        const rd = typeof roleDraft === 'string' ? { label: roleDraft } : roleDraft;
        // For each role entry, create a role with slot code
        const slot = shortCodeGenerator.generateRoleSlot(expandedRoles);
        const roleCode = shortCodeGenerator.generateRoleCode(shortCode, slot);

        expandedRoles.push({
          slot,
          roleCode,
          label: rd.label || 'Rol',
          roleKey: rd.roleKey || rd.label?.toLowerCase() || 'unknown',
          details: rd.details || null,
          startTime: rd.startTime || draft.defaultStartTime || '14:00',
          durationMinutes: rd.durationMinutes || (rd.roleKey === 'ursitoare' ? 60 : 120),
          assignedCode: null,
          pendingCode: null,
        });
      }

      // Validate date
      const dateVal = dateTimeParser.parseDate(draft.date);
      const eventDate = dateVal?.valid ? dateVal.date : (draft.date || null);

      // Build event document
      const now = admin.firestore.FieldValue.serverTimestamp();
      const eventDoc = {
        schemaVersion: 2,
        shortCode,
        date: eventDate,
        address: draft.address || '',
        client: draft.client || null,
        sarbatoritNume: draft.sarbatoritNume || '',
        sarbatoritVarsta: draft.sarbatoritVarsta || '',
        sarbatoritDob: draft.sarbatoritDob || null,
        incasare: { status: 'NEINCASAT' },
        roles: expandedRoles,
        totalStaffRequired: expandedRoles.length,
        staffBreakdown: expandedRoles.map(r => ({ roleLabel: r.label, staffCount: 1, details: r.details })),
        isArchived: false,
        transcriptMessages: conversationState?.transcriptMessages || [],
        aiInterpretationLog: conversationState?.aiInterpretationLog || [],
        createdAt: now,
        createdBy: uid,
        createdByEmail: email,
        updatedAt: now,
        updatedBy: uid,
      };

      console.log('[SAVE_NOW] Creating event with shortCode:', shortCode, 'roles:', expandedRoles.length);

      const ref = await db.collection('evenimente').add(eventDoc);

      // Clear conversation state
      if (conversationState?.notingMode) {
        await stateManager.cancelNotingMode(sessionId);
      }

      return {
        ok: true,
        action: 'CREATE',
        eventId: ref.id,
        shortCode,
        roles: expandedRoles,
        message: `✅ Eveniment #${shortCode} creat cu succes!\n📅 ${eventDate || 'N/A'}\n📍 ${draft.address || 'N/A'}\n🎭 ${expandedRoles.length} roluri`,
        dryRun: false,
      };
    }

    // ── DIRECT URSITOARE HANDLER: ONLY for simple short "N ursitoare" input ──
    // If text has other content (animatori, vata, popcorn etc.), let AI handle it all
    const isShortUrsitoareOnly = normalizedText.length < 30 && /^\s*\d+\s*ursitoare\s*$/.test(normalizedText);
    const ursitoareDirectMatch = isShortUrsitoareOnly ? normalizedText.match(/(\d+)\s*ursitoare/) : null;
    if (ursitoareDirectMatch && !imageBase64) {
      const count = parseInt(ursitoareDirectMatch[1], 10);
      if (count >= 1 && count <= 10) {
        // Get existing draft to preserve other roles
        const existingDraft = conversationState?.draftEvent || {};
        const existingRoles = (existingDraft.rolesDraft || [])
          .filter(r => {
            const rk = (typeof r === 'string') ? '' : (r.roleKey || '');
            return rk !== 'ursitoare';
          });
        const defaultTime = existingRoles.find(r => r.startTime)?.startTime || '18:30';

        // Create N ursitoare
        for (let i = 1; i <= count; i++) {
          existingRoles.push({
            slot: String.fromCharCode(64 + existingRoles.length + 1),
            roleKey: 'ursitoare',
            label: 'Ursitoare',
            details: `Ursitoare ${i}`,
            startTime: defaultTime,
            durationMinutes: 60,
          });
        }

        // Update draft
        existingDraft.rolesDraft = existingRoles;
        if (!conversationState || !conversationState.notingMode) {
          conversationState = await stateManager.startNotingMode(sessionId, uid, existingDraft);
        } else {
          conversationState = await stateManager.updateDraft(sessionId, existingDraft, text, {
            decision: 'direct_ursitoare_add',
          });
        }

        return {
          ok: true,
          action: 'CONFIRM',
          message: `✅ ${count} ursitoare adăugate!`,
          draftEvent: existingDraft,
          eventData: existingDraft,
          roles: existingRoles,
          needsUrsitoareCount: false,
        };
      }
    }

    // Initialize Gemini AI
    const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });

    const imageBase64 = request.data?.image;

    // Build system prompt for AI
    let systemPrompt = buildSystemPrompt(conversationState);
    if (imageBase64) {
      systemPrompt += `\n\nATENȚIE — IMAGINE ATAȘATĂ:
Utilizatorul a încărcat O IMAGINE (bilet/formular/screenshot de rezervare).
CITEȘTE ABSOLUT TOT DIN IMAGINE, caracter cu caracter.

PASUL 1 — TEXTUL BRUT: Copiază INTEGRAL tot textul vizibil din imagine în câmpul "extractedText". NU omite NIMIC. Fiecare linie, fiecare cuvânt, fiecare număr, fiecare simbol trebuie copiat exact cum apare în imagine.

PASUL 2 — STRUCTURARE: Din textul copiat, extrage structurat în draftEvent:
- DATA completă (zi, lună, an)
- ORA de început
- ADRESA completă (restaurant, stradă, oraș)
- NUMELE COMPLET al sărbătoritului/copilului
- VÂRSTA
- NUMELE și TELEFONUL clientului/părintelui
- TOATE SERVICIILE/ROLURILE cu DETALII EXACTE:
  - PERSONAJE/TEME exacte (Elsa, Spiderman, Tom — NU "animator" generic!)
  - NUMĂRUL de ursitoare (3 sau 4)
  - ORA individuală + DURATA per serviciu
- ORICE altă informație vizibilă

Folosește ÎNTOTDEAUNA action:"CONFIRM" și pune TOTUL în draftEvent + extractedText.`;
    }

    // Call AI to interpret user input
    let raw = '';
    try {
      const parts = [{ text }];

      if (imageBase64) {
        parts.push({
          inlineData: {
            data: imageBase64,
            mimeType: 'image/jpeg', // Assume general image format for base64 uploads
          },
        });
      }

      const completion = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.1, // Lowered temperature to heavily focus on accurate form data extraction
        },
      });
      raw = completion.text || '';
    } catch (e) {
      console.error('Gemini API error:', e);
      raw = '';
    }

    const cmd = extractJson(raw);

    if (!cmd || !cmd.action) {
      return {
        ok: false,
        action: 'NONE',
        message: 'Nu am putut interpreta comanda. Te rog să reformulezi.',
        raw,
      };
    }

    const action = String(cmd.action || 'NONE').toUpperCase();

    // Handle ASK_INFO (AI needs more information)
    if (action === 'ASK_INFO') {
      // Extract whatever data the AI managed to parse
      const extractedData = cmd.draftEvent || cmd.data || {};
      const extractedRoles = cmd.rolesDraft || extractedData.rolesDraft || [];

      // If in noting mode, update transcript and merge draft data
      if (conversationState && conversationState.notingMode) {
        await stateManager.addAIResponse(sessionId, cmd.message);
        if (Object.keys(extractedData).length > 0) {
          conversationState = await stateManager.updateDraft(sessionId, extractedData, text, {
            decision: 'ask_info_with_partial_data',
            clarifications: [],
          });
        }
      } else if (hasPermission && Object.keys(extractedData).length > 0) {
        // Start noting mode with whatever data we have
        conversationState = await stateManager.startNotingMode(sessionId, uid, extractedData);
      }

      return {
        ok: true,
        action: 'ASK_INFO',
        message: cmd.message || 'Am nevoie de mai multe informații.',
        eventData: conversationState?.draftEvent || extractedData,
        roles: extractedRoles,
        dryRun: true,
      };
    }

    // In Silent Mode, AI will largely output CONFIRM immediately
    if (action === 'CONFIRM' || action === 'START_NOTING' || action === 'UPDATE_DRAFT') {
      if (!hasPermission) {
        return {
          ok: false,
          action: 'NONE',
          message:
            '⚠️ Îmi pare rău, dar nu ai permisiunea de a crea/edita evenimente. Vorbește cu administratorul pentru acces.',
        };
      }

      // AI extracted data is the PRIMARY source
      const aiExtractedData = cmd.draftEvent || cmd.data || {};
      console.log('[CONFIRM] AI extracted data:', JSON.stringify(aiExtractedData, null, 2));

      // Text-based extraction as SUPPLEMENT (only fills gaps)
      const textExtracts = await extractUpdates(text, aiExtractedData, roleDetector, dateTimeParser);
      console.log('[CONFIRM] Text-based extracts:', JSON.stringify(textExtracts, null, 2));

      // MERGE: AI data is base, text extracts fill gaps only
      const finalData = { ...aiExtractedData };
      for (const [key, value] of Object.entries(textExtracts)) {
        if (value !== null && value !== undefined && value !== '') {
          // Only override if AI didn't provide this field OR the field is empty
          if (!finalData[key] || finalData[key] === null || finalData[key] === '') {
            finalData[key] = value;
          }
          // Special case: merge rolesDraft arrays
          if (key === 'rolesDraft' && Array.isArray(value) && Array.isArray(finalData[key])) {
            // Keep AI roles, add text-detected roles that don't duplicate
            const existingLabels = new Set(finalData[key].map(r => r.label || r));
            for (const newRole of value) {
              const label = newRole.label || newRole;
              if (!existingLabels.has(label)) {
                finalData[key].push(newRole);
              }
            }
          }
        }
      }

      console.log('[CONFIRM] Final merged data:', JSON.stringify(finalData, null, 2));

      // ── NO shortCode at CONFIRM — only generated at SAVE time ──
      // Just assign slot letters (A, B, C) for preview
      const rolesDraft = finalData.rolesDraft || [];
      const processedRoles = [];
      let hasUrsitoare = false;

      for (const roleDraft of rolesDraft) {
        const rd = typeof roleDraft === 'string' ? { label: roleDraft } : roleDraft;
        const isUrsitoare = (rd.roleKey === 'ursitoare' || rd.label?.toLowerCase() === 'ursitoare');
        if (isUrsitoare) hasUrsitoare = true;

        const slot = String.fromCharCode(65 + processedRoles.length); // A, B, C...
        processedRoles.push({
          slot,
          label: rd.label || 'Rol',
          roleKey: rd.roleKey || rd.label?.toLowerCase() || 'unknown',
          details: rd.details || null,
          startTime: rd.startTime || null,
          durationMinutes: rd.durationMinutes || (isUrsitoare ? 60 : 120),
        });
      }

      // ── POST-PROCESSING: fix roles deterministically ──
      const finalRoles = [];
      for (const role of processedRoles) {
        const details = (role.details || '').toLowerCase();
        const label = (role.label || '').toLowerCase();

        // 1) Reclassify "pictura pe fata" / "face painting" → separate role, NOT animator
        if (details.includes('pictur') || details.includes('face paint') ||
            label.includes('pictur') || label.includes('face paint')) {
          finalRoles.push({
            ...role,
            roleKey: 'facepainting',
            label: 'Pictura pe față',
            details: role.details,
          });
          continue;
        }

        // 2) Split "X și Y" / "X&Y" / "X, Y" into separate animator entries
        if (role.roleKey === 'animator') {
          // Check both details and label for compound names
          const textToSplit = role.details || role.label || '';
          // Match: "și", "si", "&", ",", "/" with or without surrounding spaces
          const splitPattern = /\s*(?:\bși\b|\bsi\b|&|,|\/)\s*/i;
          const parts = textToSplit.split(splitPattern).map(p => p.trim()).filter(Boolean);
          if (parts.length > 1) {
            for (const part of parts) {
              finalRoles.push({
                ...role,
                label: 'Animator',
                details: part,
                slot: '',
              });
            }
            continue;
          }
        }

        finalRoles.push(role);
      }

      // Re-assign slot letters after splitting
      for (let i = 0; i < finalRoles.length; i++) {
        finalRoles[i].slot = String.fromCharCode(65 + i);
      }

      // ── ENFORCE exact ursitoare count from text ──
      const ursitoareCountMatch = normalizedText.match(/(\d+)\s*ursitoare/);
      if (ursitoareCountMatch) {
        const wantedCount = parseInt(ursitoareCountMatch[1], 10);
        // Remove all existing ursitoare
        const nonUrsitoare = finalRoles.filter(r => r.roleKey !== 'ursitoare');
        const defaultTime = finalRoles.find(r => r.startTime)?.startTime || '18:30';
        // Add exactly the right number
        for (let i = 1; i <= wantedCount; i++) {
          nonUrsitoare.push({
            slot: '',
            roleKey: 'ursitoare',
            label: 'Ursitoare',
            details: `Ursitoare ${i}`,
            startTime: defaultTime,
            durationMinutes: 60,
          });
        }
        // Re-slot
        for (let i = 0; i < nonUrsitoare.length; i++) {
          nonUrsitoare[i].slot = String.fromCharCode(65 + i);
        }
        finalRoles.length = 0;
        finalRoles.push(...nonUrsitoare);
        hasUrsitoare = true;
      }

      // Show ursitoare picker ONLY when ursitoare mentioned but no entries created
      const mentionsUrsitoare = normalizedText.includes('ursitoare') || normalizedText.includes('botez');
      const needsUrsitoareCount = mentionsUrsitoare && !hasUrsitoare;

      // ── VATA + POPCORN COMBO DETECTION ──
      const hasVata = finalRoles.some(r => r.roleKey === 'vata' || (r.label || '').toLowerCase().includes('vat'));
      const hasPopcorn = finalRoles.some(r => r.roleKey === 'popcorn' || (r.label || '').toLowerCase().includes('popcorn'));
      const mentionsVata = normalizedText.includes('vata') || normalizedText.includes('vată');
      const mentionsPopcorn = normalizedText.includes('popcorn') || normalizedText.includes('floricele');
      const bothVataPopcorn = (hasVata && hasPopcorn) || (mentionsVata && mentionsPopcorn);
      let needsVataPopcornChoice = false;

      if (bothVataPopcorn) {
        // Remove vata and popcorn roles — user will choose combo vs separate
        for (let i = finalRoles.length - 1; i >= 0; i--) {
          const rk = finalRoles[i].roleKey || '';
          const lb = (finalRoles[i].label || '').toLowerCase();
          if (rk === 'vata' || rk === 'popcorn' || rk === 'vataPopcorn' ||
              lb.includes('vat') || lb.includes('popcorn') || lb.includes('floricele')) {
            finalRoles.splice(i, 1);
          }
        }
        // Re-slot
        for (let i = 0; i < finalRoles.length; i++) {
          finalRoles[i].slot = String.fromCharCode(65 + i);
        }
        needsVataPopcornChoice = true;
      }

      finalData.rolesDraft = finalRoles;

      // Force state update natively
      if (!conversationState || !conversationState.notingMode) {
        conversationState = await stateManager.startNotingMode(sessionId, uid, finalData);
      } else {
        conversationState = await stateManager.updateDraft(sessionId, finalData, text, {
          decision: 'silent_update_draft',
          clarifications: [],
        });
      }

      // No more questions, straight to confirmation UI
      const summary =
        cmd.message || 'Verifică datele de mai sus și apasă Salvează!';
      await stateManager.addAIResponse(sessionId, summary);

      const responseDraft = conversationState?.draftEvent || finalData;
      console.log('[CONFIRM] roles:', finalRoles.length, 'needsUrsitoareCount:', needsUrsitoareCount, 'needsVataPopcornChoice:', needsVataPopcornChoice);

      return {
        ok: true,
        action: 'CONFIRM',
        message: summary,
        extractedText: cmd.extractedText || null,
        draftEvent: responseDraft,
        eventData: responseDraft,
        roles: finalRoles,
        needsUrsitoareCount,
        needsVataPopcornChoice,
      };
    }

    // Handle CREATE (create new event)
    if (action === 'CREATE') {
      if (!hasPermission) {
        return {
          ok: false,
          action: 'NONE',
          message: '⚠️ Permisiune respinsă pentru crearea de evenimente.',
        };
      }

      const data = cmd.data || {};

      // If in noting mode, use draft data
      if (conversationState && conversationState.notingMode) {
        Object.assign(data, conversationState.draftEvent);
      }

      // Validate required fields
      const dateValidation = dateTimeParser.parseDate(data.date);
      if (!dateValidation || !dateValidation.valid) {
        return {
          ok: false,
          action: 'NONE',
          message: dateValidation?.message || 'Lipsește data evenimentului.',
        };
      }

      if (!data.address || !data.address.trim()) {
        return {
          ok: false,
          action: 'NONE',
          message: 'Lipsește adresa evenimentului.',
        };
      }

      // Generate short code
      const shortCode = await shortCodeGenerator.generateEventShortCode();

      // Process roles
      const roles = await processRoles(data.rolesDraft || [], shortCode, shortCodeGenerator);

      // Create event document
      const now = admin.firestore.FieldValue.serverTimestamp();

      const eventDoc = {
        schemaVersion: 2,
        shortCode,
        date: dateValidation.date,
        address: data.address.trim(),
        client: data.client || null,
        sarbatoritNume: data.sarbatoritNume || '',
        sarbatoritVarsta: data.sarbatoritVarsta || 0,
        sarbatoritDob: data.sarbatoritDob || null,
        incasare: data.incasare || { status: 'NEINCASAT' },
        roles,
        totalStaffRequired: data.totalStaffRequired || 0,
        staffBreakdown: data.staffBreakdown || [],
        isArchived: false,
        transcriptMessages: conversationState?.transcriptMessages || [],
        aiInterpretationLog: conversationState?.aiInterpretationLog || [],
        createdAt: now,
        createdBy: uid,
        createdByEmail: email,
        updatedAt: now,
        updatedBy: uid,
      };

      if (dryRun) {
        return {
          ok: true,
          action: 'CREATE',
          data: eventDoc,
          message: 'Preview: Eveniment va fi creat cu aceste date',
          dryRun: true,
        };
      }

      const ref = await db.collection('evenimente').add(eventDoc);

      // Clear conversation state
      if (conversationState && conversationState.notingMode) {
        await stateManager.cancelNotingMode(sessionId);
      }

      return {
        ok: true,
        action: 'CREATE',
        eventId: ref.id,
        shortCode,
        message: `✅ Eveniment creat cu succes!\n📋 Cod: ${shortCode}\n📅 Data: ${dateValidation.date}\n📍 Adresa: ${data.address}`,
        dryRun: false,
      };
    }

    // Handle UPDATE (update existing event)
    if (action === 'UPDATE') {
      const eventId = String(cmd.eventId || '').trim();
      if (!eventId) {
        return { ok: false, action: 'NONE', message: 'UPDATE necesită eventId.' };
      }

      // Check permissions
      if (!dryRun) {
        const eventDoc = await db.collection('evenimente').doc(eventId).get();
        if (!eventDoc.exists) {
          return { ok: false, action: 'NONE', message: 'Evenimentul nu există.' };
        }
      }

      const patch = sanitizeUpdateFields(cmd.data || {});
      patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      patch.updatedBy = uid;

      if (dryRun) {
        return {
          ok: true,
          action: 'UPDATE',
          eventId,
          data: patch,
          message: `Preview: Eveniment ${eventId} va fi actualizat`,
          dryRun: true,
        };
      }

      await db.collection('evenimente').doc(eventId).update(patch);

      return {
        ok: true,
        action: 'UPDATE',
        eventId,
        message: `✅ Eveniment actualizat: ${eventId}`,
        dryRun: false,
      };
    }

    // Handle ARCHIVE
    if (action === 'ARCHIVE') {
      const eventId = String(cmd.eventId || '').trim();
      if (!eventId) {
        return { ok: false, action: 'NONE', message: 'ARCHIVE necesită eventId.' };
      }

      // Check permissions
      if (!dryRun) {
        const eventDoc = await db.collection('evenimente').doc(eventId).get();
        if (!eventDoc.exists) {
          return { ok: false, action: 'NONE', message: 'Evenimentul nu există.' };
        }
      }

      const update = {
        isArchived: true,
        archivedAt: admin.firestore.FieldValue.serverTimestamp(),
        archivedBy: uid,
        ...(cmd.reason ? { archiveReason: String(cmd.reason) } : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: uid,
      };

      if (dryRun) {
        return {
          ok: true,
          action: 'ARCHIVE',
          eventId,
          message: `Preview: Eveniment ${eventId} va fi arhivat`,
          dryRun: true,
        };
      }

      await db.collection('evenimente').doc(eventId).update(update);

      return {
        ok: true,
        action: 'ARCHIVE',
        eventId,
        message: `✅ Eveniment arhivat: ${eventId}`,
        dryRun: false,
      };
    }

    // Handle LIST
    if (action === 'LIST') {
      const limit = Math.max(1, Math.min(50, Number(cmd.limit || 10)));

      const snap = await db
        .collection('evenimente')
        .where('isArchived', '==', false)
        .orderBy('date', 'desc')
        .limit(limit)
        .get();

      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      return { ok: true, action: 'LIST', items, dryRun: false };
    }

    return {
      ok: false,
      action: 'NONE',
      message: `Acțiune necunoscută: ${action}`,
      raw,
    };
  }
);

// Helper functions

function extractJson(text) {
  if (!text) return null;
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  const slice = text.slice(first, last + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

function buildSystemPrompt(conversationState) {
  const prompt = `
Ești asistentul inteligent Superparty. Scopul tău principal este să citești informația primită (text sau formular lipit/poză) și să notezi evenimentul INSTANTANEU, fără să conversezi pas cu pas.

IMPORTANT - OUTPUT FORMAT:
- Returnează DOAR JSON valid, fără text extra, fără markdown.
- Răspunsul trebuie să fie exact un obiect JSON parsabil.

REGULI DE EXTRAGERE (SILENT MODE):
- NU PUNE NICIODATĂ ÎNTREBĂRI SUPLIMENTARE (FĂRĂ ASK_INFO).
- EXTRAGE TOT CE GĂSEȘTI (Dată, Oră, Locație, Roluri, Sărbătorit, Contact) din prima.
- Ce lipsește ignoră sau lasă null/gol. Nu trebuie să ceri datele lipsă.

ACȚIUNEA PRINCIPALĂ:
- Indiferent de cât de puține sau multe informații primești despre o petrecere nouă, returnează mereu acțiunea: "CONFIRM".
- Trebuie să pui toate detaliile extrase în interiorul proprietății "draftEvent" (vezi exemplul de mai jos).
- În proprietatea "message" scrie un scurt rezumat de confirmare: "Am extras datele. Verifică biletul de mai sus și apasă Salvează."

REGULI SPECIALE ROLURI:
- URSITOARE: Dacă textul specifică un NUMĂR de ursitoare (ex: "3 ursitoare", "4 ursitoare"), CREEAZĂ EXACT atâtea intrări separate (Ursitoare 1, Ursitoare 2, etc). Dacă scrie DOAR "ursitoare" FĂRĂ număr, NU crea nicio intrare ursitoare (utilizatorul va alege numărul din interfață). Durata standard ursitoare: 60 minute.
- ANIMATOR: Animator = PERSONAJ/TEMĂ (ex: Elsa, Spiderman, Batman, Hulk, Tom, Jerry). Fiecare personaj diferit → intrare separată cu roleKey:"animator". Durata standard: 120 minute.
- PICTURA PE FAȚĂ: "Pictura pe față" / "face painting" = ROL SEPARAT cu roleKey:"facepainting", label:"Pictura pe față". NU este animator! Durata standard: 120 minute.
- ALTE SERVICII: Balon modeling, candy bar, foto/video, DJ etc = fiecare cu roleKey propriu.
- FIECARE ROL trebuie să aibă: roleKey, label, details, startTime, durationMinutes.
- startTime: ora la care începe rolul (ex: "19:00"). Dacă nu e specificată, folosește ora generală din text.
- durationMinutes: durata în minute (ursitoare=60, animator=120, altele=120 default).

FORMAT JSON AȘTEPTAT PENTRU NOTARE:
{
  "action": "CONFIRM",
  "message": "Am citit mesajul/formularul tău. Verifică datele extrase pe tichet și apasă Salvează!",
  "extractedText": "COPIAZĂ AICI TOT TEXTUL BRUT DIN IMAGINE/MESAJ, LINIE CU LINIE, FĂRĂ SĂ OMITI NIMIC",
  "draftEvent": {
    "date": "extrage data si ora",
    "address": "extrage adresa completă (restaurant, oras etc)",
    "client": { "name": "nume parinte/client", "phone": "07..." },
    "sarbatoritNume": "nume sarbatorit",
    "sarbatoritVarsta": 7,
    "rolesDraft": [
      {"roleKey": "animator", "label": "Animator", "details": "Elsa", "startTime": "19:00", "durationMinutes": 120},
      {"roleKey": "animator", "label": "Animator", "details": "Spiderman", "startTime": "19:00", "durationMinutes": 120},
      {"roleKey": "ursitoare", "label": "Ursitoare", "details": "Ursitoare 1", "startTime": "18:30", "durationMinutes": 60},
      {"roleKey": "ursitoare", "label": "Ursitoare", "details": "Ursitoare 2", "startTime": "18:30", "durationMinutes": 60},
      {"roleKey": "ursitoare", "label": "Ursitoare", "details": "Ursitoare 3", "startTime": "18:30", "durationMinutes": 60}
    ]
  }
}

CONVERSAȚIE GENERALĂ:
Dacă utilizatorul pune o întrebare oarecare (ex: "ce faci?"), întoarce action:"NONE" și poartă o discuție scurtă în câmpul "message".`;


  return prompt.trim();
}

function calculateStaffRequired(rolesDraft, roleDetector) {
  let total = 0;
  const breakdown = [];

  if (!rolesDraft || !Array.isArray(rolesDraft)) {
    return { total: 0, breakdown: [] };
  }

  for (const draft of rolesDraft) {
    // roleKey might be injected from roleDetector, let's ensure we can find it
    // if roleKey is missing in draft, try to find it by matching label
    let roleKey = draft.roleKey;
    if (!roleKey) {
      const allRoles = roleDetector.getAllRoles();
      const matched = allRoles.find(r => r.label === draft.label);
      if (matched) roleKey = matched.key;
    }

    if (!roleKey) continue;

    const roleDef = roleDetector.getRoleDefinition(roleKey);
    if (!roleDef) continue;

    let staffForThisRole = roleDef.baseStaffNeeded || 1;

    // Special case for Ursitoare: override base (3) with explicit count if provided
    if (roleKey === 'ursitoare' && draft.details && draft.details.count) {
      staffForThisRole = parseInt(draft.details.count, 10);
    }

    total += staffForThisRole;
    breakdown.push({
      roleLabel: draft.label,
      staffCount: staffForThisRole,
      details: draft.details || null,
    });
  }

  return { total, breakdown };
}

async function extractUpdates(text, currentDraft, roleDetector, dateTimeParser) {
  const updates = {};

  // Extract date
  const dateMatch = text.match(/(\d{2})[-/.](\d{2})[-/.](\d{4})/);
  if (dateMatch) {
    const dateValidation = dateTimeParser.parseDate(dateMatch[0]);
    if (dateValidation && dateValidation.valid) {
      updates.date = dateValidation.date;
    }
  }

  // Extract phone
  const phoneValidation = dateTimeParser.parsePhone(text);
  if (phoneValidation && phoneValidation.valid) {
    updates.client = phoneValidation.phone;
  }

  // Extract address (simple heuristic)
  const addressKeywords = ['adresa', 'locatia', 'locația', 'la'];
  const normalizedText = text.toLowerCase();
  for (const keyword of addressKeywords) {
    const index = normalizedText.indexOf(keyword);
    if (index !== -1) {
      const afterKeyword = text.substring(index + keyword.length).trim();
      const addressMatch = afterKeyword.match(/^[:\s]*([^,\n]+)/);
      if (addressMatch) {
        updates.address = addressMatch[1].trim();
        break;
      }
    }
  }

  // NOTE: Roles are extracted ONLY by AI (Gemini), NOT by roleDetector.
  // roleDetector.detectRoles() was causing false-positive role injection
  // (e.g., "pictura pe fata" appearing when not in the original text).

  return updates;
}

async function processRoles(rolesDraft, eventShortCode, shortCodeGenerator) {
  const roles = [];

  for (let i = 0; i < rolesDraft.length; i++) {
    const draft = rolesDraft[i];
    const slot = shortCodeGenerator.generateRoleSlot(roles);
    const roleCode = shortCodeGenerator.generateRoleCode(eventShortCode, slot);

    roles.push({
      slot,
      roleCode,
      label: draft.label,
      startTime: draft.startTime || '14:00',
      durationMinutes: draft.durationMinutes || 120,
      details: draft.details || null,
      assignedCode: null,
      pendingCode: null,
    });
  }

  return roles;
}

function sanitizeUpdateFields(data) {
  const allowed = new Set([
    'date',
    'address',
    'client',
    'sarbatoritNume',
    'sarbatoritVarsta',
    'sarbatoritDob',
    'incasare',
    'roles',
  ]);

  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (!allowed.has(k)) continue;
    out[k] = v;
  }
  return out;
}
