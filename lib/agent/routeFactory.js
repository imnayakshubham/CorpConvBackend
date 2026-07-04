// lib/agent/routeFactory.js — turn a FeaturePlugin into Express handlers.
//
// createAgentHandlers(plugin) → { chat, summarize }. Handles request validation,
// abort-on-disconnect wiring, and context extraction, then delegates the AI work to
// the orchestrator. The route file mounts these with its own auth/limit/quota stack.

const engine = require('./engine');
const { handleChat, handleSummarize } = require('./orchestrator');

function baseValidate(body, contextKey) {
  if (!body || typeof body !== 'object') return 'Request body is required.';
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return 'messages must be a non-empty array.';
  }
  const ctx = body[contextKey];
  if (ctx != null && typeof ctx !== 'object') return `${contextKey} must be an object when provided.`;
  return null;
}

// opts (optional): { saveRollingSummary, loadContextSummary } — injected by the route layer
// so the generic harness never imports a DB model. When present, a rolling summary of older
// turns is refreshed in the background (onEnd) and injected into the model context.
function createAgentHandlers(plugin, opts = {}) {
  // Streaming handler — the response keeps writing AFTER handleChat resolves, so the
  // disconnect listener is removed by res 'finish' (or on a setup error), never eagerly.
  const chat = async (req, res) => {
    const err = baseValidate(req.body, plugin.contextKey);
    if (err) return res.status(400).json({ error: err });
    const context = req.body[plugin.contextKey] || {};
    const ctxErr = plugin.validateContext ? plugin.validateContext(context) : null;
    if (ctxErr) return res.status(400).json({ error: ctxErr });

    const abortController = new AbortController();
    const onClose = () => abortController.abort();
    req.on('close', onClose);
    res.on('finish', () => req.off('close', onClose));

    // Bind the summary hooks to this user + resource (only when a store was injected).
    const persistence = (opts.saveRollingSummary || opts.loadContextSummary)
      ? {
          userId: req.user && (req.user._id || req.user.id),
          featureKey: plugin.key,
          resourceId: req.params.id,
          saveRollingSummary: opts.saveRollingSummary,
          loadContextSummary: opts.loadContextSummary,
        }
      : null;

    try {
      const webSearchEnabled = req.body.webSearchEnabled !== false; // default ON
      await handleChat({ engine, plugin, messages: req.body.messages, context, webSearchEnabled, res, abortSignal: abortController.signal, persistence });
    } catch (e) {
      req.off('close', onClose);
      if (abortController.signal.aborted) return;
      console.error(`[agent:${plugin.key}] chat handler error:`, e);
      if (!res.headersSent) res.status(500).json({ error: 'AI service unavailable. Please try again.' });
    }
  };

  // Non-streaming handler — fully resolves before responding, so finally cleanup is safe.
  const summarize = async (req, res) => {
    const err = baseValidate(req.body, plugin.contextKey);
    if (err) return res.status(400).json({ error: err });

    const abortController = new AbortController();
    const onClose = () => abortController.abort();
    req.on('close', onClose);

    try {
      await handleSummarize({ engine, plugin, messages: req.body.messages, res, abortSignal: abortController.signal });
    } finally {
      req.off('close', onClose);
    }
  };

  return { chat, summarize };
}

module.exports = { createAgentHandlers, baseValidate };
