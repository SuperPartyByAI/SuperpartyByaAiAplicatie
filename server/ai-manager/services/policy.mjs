/**
 * services/policy.mjs
 * Simple policy engine: applies business rules to AI output.
 * Adds policy_flags, adjusts escalation threshold, checks confidence.
 */

import { config } from '../config/config.mjs';

const HIGH_RISK_KEYWORDS = [
  'salarii', 'pontaj', 'concediere', 'dosar', 'accident',
  'furt', 'frauda', 'spital', 'politie', 'avocat', 'judecata',
  'salary', 'dismissal', 'fraud', 'accident', 'police',
];

/**
 * @param {object} aiResult - raw result from analyzeEvent()
 * @param {object} [context]
 * @returns {object} - augmented result with policy enforcement applied
 */
export function applyPolicy(aiResult, context = {}) {
  const flags = [...(aiResult.policy_flags ?? [])];
  let { should_escalate_to_human, confidence } = aiResult;

  // Rule 1: Critical events always escalate
  if (aiResult.priority === 'critical') {
    flags.push('CRITICAL_PRIORITY_ESCALATE');
    should_escalate_to_human = true;
  }

  // Rule 2: Low confidence → escalate
  if (confidence < config.policy.escalateThreshold) {
    flags.push('LOW_CONFIDENCE_ESCALATE');
    should_escalate_to_human = true;
  }

  // Rule 3: High-risk keywords in summary or next_action → escalate
  const searchText = [
    aiResult.summary ?? '',
    aiResult.next_action ?? '',
    aiResult.intent ?? '',
  ].join(' ').toLowerCase();

  for (const kw of HIGH_RISK_KEYWORDS) {
    if (searchText.includes(kw)) {
      flags.push(`HIGH_RISK_KEYWORD:${kw.toUpperCase()}`);
      should_escalate_to_human = true;
      break;
    }
  }

  // Rule 4: Salary/work-hour decisions blocked from auto-approve
  if (aiResult.event_type === 'employee_report' || aiResult.event_type === 'driver_report') {
    flags.push('REQUIRES_HUMAN_APPROVAL_STAFFHOURS');
    should_escalate_to_human = true;
  }

  // Rule 5: Very high confidence + non-sensitive → can auto-suggest (NOT auto-approve)
  const canAutoSuggest =
    confidence >= config.policy.maxConfidenceAutoApprove &&
    !should_escalate_to_human &&
    flags.length === 0;

  return {
    ...aiResult,
    policy_flags: flags,
    should_escalate_to_human,
    can_auto_suggest: canAutoSuggest,
    policy_applied_at: new Date().toISOString(),
  };
}
