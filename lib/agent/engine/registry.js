// lib/agent/engine/registry.js — provider/model registry for the Vercel adapter.
//
// Maps a logical ROLE to a concrete provider+model via env, so the model is config.
// Spec format: "<provider>:<modelId>", e.g. "groq:openai/gpt-oss-120b" or
// "anthropic:claude-sonnet-4-6". Bare model ids (legacy HUSH_AI_MODEL) are assumed groq.
//
// Provider SDKs (@ai-sdk/*) are ESM-only under AI SDK v7, so they are loaded via dynamic
// import() by initRegistry() at server boot (invoked from the adapter's init()).
//
// Adding a provider later (e.g. Anthropic) is a 3-step, no-call-site-change move:
//   1. npm i @ai-sdk/anthropic
//   2. set ANTHROPIC_API_KEY
//   3. set AGENT_PRIMARY=anthropic:claude-... (or per-role)

let _providers = null;

// Dynamically import an optional provider package so a missing dependency never crashes
// boot — the provider is simply unavailable until installed + keyed.
async function tryRegister(providers, id, pkg, factoryName, keyVar) {
  if (!process.env[keyVar]) return;
  try {
    const mod = await import(pkg);
    const factory = mod[factoryName];
    providers[id] = factory({ apiKey: process.env[keyVar] });
  } catch (_) {
    // package not installed — leave unregistered
  }
}

// Build the provider map once, using dynamic imports. Called from the adapter's init().
async function initRegistry() {
  if (_providers) return _providers;
  const p = {};
  if (process.env.GROQ_API_KEY) {
    const { createGroq } = await import('@ai-sdk/groq');
    p.groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
  }
  await tryRegister(p, 'anthropic', '@ai-sdk/anthropic', 'createAnthropic', 'ANTHROPIC_API_KEY');
  await tryRegister(p, 'openai', '@ai-sdk/openai', 'createOpenAI', 'OPENAI_API_KEY');
  _providers = p;
  return p;
}

function providers() {
  if (!_providers) throw new Error('Agent provider registry not initialized — call engine.init() at startup.');
  return _providers;
}

// Prefix a bare (provider-less) model id with the default provider for back-compat.
const withProvider = (m) => (m ? (m.includes(':') ? m : `groq:${m}`) : null);

function roleSpec(role) {
  const primary = process.env.AGENT_PRIMARY || withProvider(process.env.HUSH_AI_MODEL) || 'groq:openai/gpt-oss-120b';
  const fast = process.env.AGENT_FAST || withProvider(process.env.HUSH_AI_FALLBACK) || 'groq:openai/gpt-oss-20b';
  const map = {
    primary,
    fast,
    planner: process.env.AGENT_PLANNER || primary,
    critic: process.env.AGENT_CRITIC || fast,
    summary: process.env.AGENT_SUMMARY || primary,
    summaryFallback: fast,
    extract: process.env.AGENT_EXTRACT || fast,
  };
  return map[role] || primary;
}

const _cache = new Map();

function getModel(role = 'primary') {
  const spec = roleSpec(role);
  if (_cache.has(spec)) return _cache.get(spec);
  const idx = spec.indexOf(':');
  const providerId = idx === -1 ? 'groq' : spec.slice(0, idx);
  const modelId = idx === -1 ? spec : spec.slice(idx + 1);
  const provider = providers()[providerId];
  if (!provider) {
    throw new Error(`Agent provider "${providerId}" is not configured (set its API key / install its package).`);
  }
  const model = provider(modelId);
  _cache.set(spec, model);
  return model;
}

module.exports = { getModel, roleSpec, initRegistry };
