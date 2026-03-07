/**
 * services/providers/provider-router.mjs
 * Routes AI analysis to the correct backend based on AI_PROVIDER env.
 *
 * Priority:
 *   1. AI_PROVIDER=local  → Ollama (default)
 *   2. AI_PROVIDER=openai → OpenAI API (requires OPENAI_API_KEY)
 *   3. FALLBACK_PROVIDER=openai → falls back to OpenAI if local fails
 *
 * The service starts and operates without OPENAI_API_KEY.
 */

import { config } from '../../config/config.mjs';
import { analyzeEventLocal, checkLocalLlm } from './local-llm.mjs';

let _openaiAnalyze = null;

/**
 * Lazy-load OpenAI module only when needed (optional fallback).
 */
async function getOpenAIAnalyze() {
  if (_openaiAnalyze) return _openaiAnalyze;
  if (!config.openai.apiKey) {
    throw new Error('OPENAI_API_KEY not set — cannot use OpenAI provider');
  }
  const mod = await import('../openai.mjs');
  _openaiAnalyze = mod.analyzeEvent;
  return _openaiAnalyze;
}

/**
 * Route an analyze-event call to the appropriate provider.
 *
 * @param {object} payload
 * @returns {{ result, model, tokensUsed, latencyMs }}
 */
export async function routeAnalyzeEvent(payload) {
  const provider = config.ai.provider;
  const fallback = config.ai.fallbackProvider;

  // Primary: local (Ollama)
  if (provider === 'local') {
    try {
      return await analyzeEventLocal(payload);
    } catch (err) {
      if (fallback === 'openai') {
        const openaiAnalyze = await getOpenAIAnalyze();
        const result = await openaiAnalyze(payload);
        // tag that we used fallback
        result.model = `fallback:openai:${result.model}`;
        result.result.policy_flags = [...(result.result.policy_flags ?? []), 'used_openai_fallback'];
        return result;
      }
      throw err; // no fallback configured
    }
  }

  // Primary: openai
  if (provider === 'openai') {
    try {
      return await (await getOpenAIAnalyze())(payload);
    } catch (err) {
      if (fallback === 'local') {
        const result = await analyzeEventLocal(payload);
        result.model = `fallback:local:${result.model}`;
        return result;
      }
      throw err;
    }
  }

  throw new Error(`Unknown AI_PROVIDER: ${provider}. Use 'local' or 'openai'.`);
}

/**
 * Returns health/readiness info for the configured AI provider.
 */
export async function getProviderHealth() {
  const provider = config.ai.provider;
  const fallback = config.ai.fallbackProvider;

  const health = {
    primary_provider: provider,
    fallback_provider: fallback,
    openai_key_configured: !!config.openai.apiKey,
  };

  if (provider === 'local' || fallback === 'local') {
    health.local_llm = await checkLocalLlm();
  }

  return health;
}
