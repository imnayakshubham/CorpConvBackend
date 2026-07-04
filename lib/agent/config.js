// lib/agent/config.js — env-driven tuning shared across the agent harness.
//
// All values are framework-neutral (no `ai` import). Model/provider selection
// lives in engine/registry.js; these are budgets, ceilings, and pacing knobs.

const num = (envVar, fallback) => Number(process.env[envVar] || fallback);

module.exports = {
  // Per-request token budget. Every request ships system prompt + tool schemas +
  // history, so we keep the total comfortably under the provider's per-minute cap.
  REQUEST_TOKEN_BUDGET: num('HUSH_AI_REQUEST_TOKEN_BUDGET', 6500),

  // The provider counts a request as prompt + reserved output. We size the prompt so
  // `prompt + maxOutput + margin` stays under this hard cap (Groq free tier = 8000 TPM).
  MODEL_TPM_LIMIT: num('HUSH_AI_TPM_LIMIT', 8000),
  TPM_MARGIN: num('HUSH_AI_TPM_MARGIN', 400),

  // Output ceilings per call. The edit path reserves this against the TPM cap, so keep it
  // modest — enough for a reply plus a tool call (e.g. add_fields), not a huge generation.
  NORMAL_MAX_OUTPUT_TOKENS: num('HUSH_AI_MAX_OUTPUT_TOKENS', 1200),
  PLANNER_MAX_OUTPUT_TOKENS: num('HUSH_AI_PLANNER_MAX_OUT', 700),
  PAGE_MAX_OUTPUT_TOKENS: num('HUSH_AI_PAGE_MAX_OUT', 1600),
  CRITIC_MAX_OUTPUT_TOKENS: num('HUSH_AI_CRITIC_MAX_OUT', 400),

  // Agentic loop + pacing.
  MAX_STEPS: num('HUSH_AI_MAX_STEPS', 8),
  TPM_BUDGET: num('HUSH_AI_TPM_BUDGET', 7000), // headroom under the provider's ~8000/min
  MAX_429_RETRIES: 3,

  // Large-input divide-and-conquer.
  LARGE_MSG_THRESHOLD: 3500, // ~1000 tokens — trigger D&C above this
  DC_CHUNK_SIZE: 1800, // ~500 tokens per extraction chunk

  // Default brand name used in user-facing error copy (a plugin may override).
  BRAND_NAME: process.env.HUSH_AI_BRAND || 'Hush AI',
};
