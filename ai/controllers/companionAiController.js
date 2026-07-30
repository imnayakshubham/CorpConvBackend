// Thin shim mounting the Companion coach plugin on the harness. All AI logic is generic;
// the coach behaviour lives in ../agents/companion.js.

const { createAgentHandlers } = require('../orchestrator/routeFactory');
const coachAgent = require('../agents/companion');
const { saveRollingSummary, loadContextSummary } = require('./hushAiConversationController');

// Inject the durable store's summary hooks so a rolling summary of older turns is refreshed
// in the background (onEnd) and folded into the model context. The transcript itself is
// persisted by the client (see companionAiRoutes conversation PUT).
const { chat, summarize } = createAgentHandlers(coachAgent, { saveRollingSummary, loadContextSummary });

module.exports = { companionAiChat: chat, companionAiSummarize: summarize };
