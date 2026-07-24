// companionAiController.js — thin shim mounting the Companion coach plugin on the generic
// agent harness (lib/agent/*). Mirrors hushAiController.js. All AI logic is generic; the
// coach-specific behavior lives in features/coachAgent.js.

const { createAgentHandlers } = require('../lib/agent/routeFactory');
const coachAgent = require('../features/coachAgent');
const { saveRollingSummary, loadContextSummary } = require('./hushAiConversationController');

// Inject the durable store's summary hooks so a rolling summary of older turns is refreshed
// in the background (onEnd) and folded into the model context. The transcript itself is
// persisted by the client (see companionAiRoutes conversation PUT).
const { chat, summarize } = createAgentHandlers(coachAgent, { saveRollingSummary, loadContextSummary });

module.exports = { companionAiChat: chat, companionAiSummarize: summarize };
