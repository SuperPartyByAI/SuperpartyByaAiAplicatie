/**
 * config.mjs — AI Manager configuration
 * Validates all required environment variables at startup.
 * Never log secrets, never export raw env.
 */

import 'dotenv/config';

function require_(name) {
  const val = process.env[name];
  if (!val) throw new Error(`[config] Missing required env var: ${name}`);
  return val;
}

function optional(name, defaultValue = undefined) {
  return process.env[name] ?? defaultValue;
}

export const config = {
  port: parseInt(optional('PORT', '3002'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),
  adminToken: require_('AI_ADMIN_TOKEN'),

  supabase: {
    url: require_('SUPABASE_URL'),
    serviceKey: require_('SUPABASE_SERVICE_KEY'),
  },

  openai: {
    apiKey: require_('OPENAI_API_KEY'),
    model: optional('OPENAI_MODEL', 'gpt-4o-mini'),
  },

  redis: {
    url: optional('REDIS_URL', 'redis://localhost:6379'),
  },

  log: {
    level: optional('LOG_LEVEL', 'info'),
  },

  policy: {
    maxConfidenceAutoApprove: parseFloat(optional('AI_MAX_CONFIDENCE_AUTO_APPROVE', '0.95')),
    escalateThreshold: parseFloat(optional('AI_ESCALATE_THRESHOLD', '0.50')),
  },

  gps: {
    sediu: {
      lat: parseFloat(optional('GEOFENCE_SEDIU_LAT', '44.4268')),
      lng: parseFloat(optional('GEOFENCE_SEDIU_LNG', '26.1025')),
      radiusM: parseFloat(optional('GEOFENCE_SEDIU_RADIUS_M', '200')),
    },
  },

  analysis: {
    concurrency: parseInt(optional('ANALYSIS_CONCURRENCY', '2'), 10),
  },
};

export const isProd = config.nodeEnv === 'production';
export const isDev = !isProd;
