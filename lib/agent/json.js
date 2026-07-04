// lib/agent/json.js — framework-neutral JSON helpers for structured sub-agent output.

// Pull the first JSON value (object or array) out of a model reply that may include
// stray prose or markdown fences. Returns null when nothing parseable is found.
function extractJson(text) {
  if (typeof text !== 'string') return null;
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  const end = text.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

module.exports = { extractJson, clamp };
