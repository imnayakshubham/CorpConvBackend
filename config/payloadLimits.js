// config/payloadLimits.js — the single source of truth for request body ceilings.
//
// These used to disagree: the global body parser capped bodies at 1MB while the Hush AI
// conversation controller carried its own (unreachable) 5MB guard, so an oversized save was
// rejected by the parser and surfaced as a generic 500. One constant per ceiling, shared by
// the parser and the controller that enforces it, keeps them honest.
//
// Raising a value here is the only change needed if the underlying limit ever lifts.

const GENERAL_MAX_BODY_BYTES = 1 * 1024 * 1024;       // every route
const CONVERSATION_MAX_BODY_BYTES = 2 * 1024 * 1024;  // Hush AI conversation PUT only

// The conversation transcript is legitimately larger than any other payload, so it gets its
// own parser rather than widening the ceiling for the whole API.
const isConversationSave = (req) =>
  req.method === 'PUT' && /\/ai\/conversation\/[^/]+$/.test(req.path);

module.exports = {
  GENERAL_MAX_BODY_BYTES,
  CONVERSATION_MAX_BODY_BYTES,
  isConversationSave,
};
