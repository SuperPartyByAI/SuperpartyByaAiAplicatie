/**
 * routes/contestations.mjs
 * Contestation / Human Review workflow.
 *
 * POST  /contestations           — create contestation for an AI event
 * GET   /contestations/:id       — get contestation + evidence bundle
 * PATCH /contestations/:id/resolve — human resolves (approve/reject/revise)
 * GET   /contestations           — list pending contestations
 */

import { Router } from 'express';
import { insertRow, updateRow, getRow, queryRows } from '../services/supabase.mjs';
import { writeAuditLog } from '../services/audit.mjs';

const router = Router();

/**
 * POST /contestations
 * { eventId, aiVerdict, aiConfidence, evidenceBundle }
 */
router.post('/', async (req, res) => {
  const { eventId, aiVerdict, aiConfidence, evidenceBundle } = req.body;
  if (!eventId || !aiVerdict) {
    return res.status(400).json({ error: 'eventId and aiVerdict required' });
  }

  try {
    const contestation = await insertRow('ai_contestations', {
      event_id: eventId,
      ai_verdict: aiVerdict,
      ai_confidence: aiConfidence ?? null,
      evidence_bundle: evidenceBundle ?? {},
      status: 'proposed',
      audit_trail: [
        {
          action: 'created',
          by: 'ai',
          at: new Date().toISOString(),
          note: 'AI-generated contestation proposal',
        },
      ],
    });

    await writeAuditLog({
      eventId,
      action: 'contestation_created',
      inputPayload: { eventId, aiVerdict, aiConfidence },
      outputPayload: { contestation_id: contestation.id },
    });

    return res.status(201).json({ ok: true, contestation });
  } catch (err) {
    req.log?.error({ err }, '[contestations/post] error');
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /contestations
 * ?status=proposed|approved|rejected|contested
 */
router.get('/', async (req, res) => {
  const { status } = req.query;
  try {
    const filters = status ? { status } : {};
    const list = await queryRows('ai_contestations', filters, { limit: 100, orderBy: 'created_at', ascending: false });
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /contestations/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const row = await getRow('ai_contestations', req.params.id);
    return res.json(row);
  } catch (err) {
    return res.status(404).json({ error: 'Contestation not found' });
  }
});

/**
 * PATCH /contestations/:id/resolve
 * {
 *   decision: "approved" | "rejected" | "contested",
 *   decidedBy: string,
 *   humanComment?: string,
 *   finalDecision?: string,
 * }
 */
router.patch('/:id/resolve', async (req, res) => {
  const { decision, decidedBy, humanComment, finalDecision } = req.body;
  if (!decision || !decidedBy) {
    return res.status(400).json({ error: 'decision and decidedBy required' });
  }
  if (!['approved', 'rejected', 'contested'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be: approved | rejected | contested' });
  }

  try {
    const existing = await getRow('ai_contestations', req.params.id);
    const trail = Array.isArray(existing.audit_trail) ? existing.audit_trail : [];

    trail.push({
      action: decision,
      by: decidedBy,
      at: new Date().toISOString(),
      note: humanComment ?? null,
    });

    const updated = await updateRow('ai_contestations', req.params.id, {
      status: decision,
      human_comment: humanComment ?? null,
      final_decision: finalDecision ?? null,
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
      audit_trail: trail,
    });

    await writeAuditLog({
      eventId: existing.event_id,
      action: `contestation_${decision}`,
      inputPayload: { decidedBy, humanComment, finalDecision },
      outputPayload: { contestation_id: req.params.id, status: decision },
    });

    return res.json({ ok: true, contestation: updated });
  } catch (err) {
    req.log?.error({ err }, '[contestations/resolve] error');
    return res.status(500).json({ error: err.message });
  }
});

export default router;
