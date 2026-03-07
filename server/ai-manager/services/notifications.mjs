/**
 * services/notifications.mjs
 * Policy-based notification system connecting AI Manager to Centrala (FCM/WebSockets)
 */

import { logger } from '../index.mjs';
import { config } from '../config/config.mjs';

// Centrala Webhook URL configurable from env
const CENTRALA_WEBHOOK_URL = process.env.CENTRALA_WEBHOOK_URL || 'http://localhost:3000/api/internal/ai-alert';

/**
 * Dispatch an alert to Centrala / Dispatchers based on AI evaluation results.
 * 
 * Rules for triggering:
 * - AI Verdict is REJECT
 * - Deviation Score > 20
 * - Any Flag Confidence is < 85% (indicating manual intervention definitely needed)
 */
export async function notifyCentralaOnTripAnomaly(tripId, employeeId, verdict, flags, deviationScore) {
  try {
    const isCritical = verdict === 'REJECT' || deviationScore > 20;
    const hasLowConfidence = flags.some(f => f.confidence < 0.85);

    if (!isCritical && !hasLowConfidence) {
      // Nominal or Warning level -> Dashboard will show it but no proactive PUSH needed.
      logger.info({ tripId, verdict }, 'Evaluation nominal. No active push to Centrala required.');
      return;
    }

    const payload = {
      event: 'trip_anomaly_detected',
      trip_id: tripId,
      employee_id: employeeId,
      severity: isCritical ? 'HIGH' : 'MEDIUM',
      reason: isCritical ? `AI Verdict: ${verdict} | Deviation: ${deviationScore}` : 'AI Confidence Low on Evaluated Flags',
      flags_count: flags.length,
      timestamp: new Date().toISOString()
    };

    logger.info({ payload }, 'Pushing Trip Anomaly Alert to Centrala (FCM/WebSocket Sync)...');

    // MOCK: Integration point for the actual POST to Centrala
    // In production, this would use fetch(CENTRALA_WEBHOOK_URL, { ... })
    // For now, we simulate the webhook dispatch successfully.

    await new Promise(resolve => setTimeout(resolve, 500));
    
    logger.info({ tripId }, 'Alert successfully dispatched to Centrala.');
  } catch (error) {
    logger.error({ error, tripId }, 'Failed to dispatch alert to Centrala');
  }
}
