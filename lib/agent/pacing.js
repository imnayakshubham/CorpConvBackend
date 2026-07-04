// lib/agent/pacing.js — framework-neutral token estimation, rolling-window pacer,
// and a rate-limit-aware retry wrapper. No `ai` import — wraps any async call.

const { TPM_BUDGET, MAX_429_RETRIES } = require('./config');
const { isRateLimitLike } = require('./errors');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Lightweight, dependency-free token estimate. Intentionally conservative
// (~3.5 chars/token) so we under-fill rather than overshoot the real limit.
function estimateTokens(value) {
  if (value == null) return 0;
  let s;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch (_) {
    return 0;
  }
  return Math.ceil((s ? s.length : 0) / 3.5);
}

// Rolling 60s token pacer. Before each model call we reserve its estimated cost;
// if the rolling window is already full we wait for the oldest entries to age out.
// After the call we reconcile with real usage so estimate drift self-corrects.
//
// reserve() is SERIALIZED via an internal mutex so concurrent callers (the multi-agent
// build runs workers in parallel through ONE pacer) can't both read a stale `used` and
// overshoot the budget. Reservations are atomic; the model calls themselves still run
// in parallel once each has reserved.
function createTokenPacer(budgetPerMin = TPM_BUDGET) {
  let entries = []; // { ts, tokens }
  let tail = Promise.resolve(); // mutex chain for reservations
  const prune = (now) => { entries = entries.filter((e) => now - e.ts < 60000); };

  const doReserve = async (estTokens) => {
    const need = Math.min(estTokens, budgetPerMin);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const now = Date.now();
      prune(now);
      const used = entries.reduce((sum, e) => sum + e.tokens, 0);
      if (used + need <= budgetPerMin || entries.length === 0) break;
      const oldest = entries[0];
      const waitMs = Math.max(250, 60000 - (now - oldest.ts));
      await sleep(waitMs);
    }
    const entry = { ts: Date.now(), tokens: need };
    entries.push(entry);
    return entry;
  };

  return {
    reserve(estTokens) {
      const run = tail.then(() => doReserve(estTokens));
      tail = run.then(() => {}, () => {}); // advance the chain even if this reserve rejects
      return run;
    },
    record(entry, actualTokens) {
      if (entry && Number.isFinite(actualTokens) && actualTokens > 0) entry.tokens = actualTokens;
    },
  };
}

// Reserve budget, run the call, reconcile usage. On a rate-limit/size error honor
// retry-after and retry up to MAX_429_RETRIES; other errors bubble up. `fn` must
// return a result whose `.usage.totalTokens` (if present) is the real token count.
async function callWithRetry(fn, { pacer, estIn, estOut }) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const entry = await pacer.reserve((estIn || 0) + (estOut || 0));
    try {
      const result = await fn();
      pacer.record(entry, result?.usage?.totalTokens);
      return result;
    } catch (err) {
      lastErr = err;
      if (!isRateLimitLike(err) || attempt === MAX_429_RETRIES) throw err;
      const retryAfter = Number(err?.responseHeaders?.['retry-after']);
      const waitSec = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(30, Math.max(1, retryAfter)) : 3;
      console.warn(`[agent] rate-limited, retrying in ${waitSec}s (attempt ${attempt + 1})`);
      await sleep(waitSec * 1000);
    }
  }
  throw lastErr;
}

module.exports = { sleep, estimateTokens, createTokenPacer, callWithRetry };
