// Thin shim mounting the survey plugin on the harness. All AI logic is generic; the
// survey behaviour lives in ../agents/survey.js. To add another feature's assistant,
// create a sibling plugin + routes — see ../types/types.js.

const { createAgentHandlers, baseValidate } = require('../orchestrator/routeFactory');
const surveyAgent = require('../agents/survey');
const { saveRollingSummary, loadContextSummary } = require('./hushAiConversationController');

// Inject the durable store's summary hooks so a rolling summary of older turns is refreshed
// in the background (onEnd) and folded into the model context. The transcript itself is
// persisted by the client (covers every path uniformly); these hooks own only the summary.
const { chat, summarize } = createAgentHandlers(surveyAgent, { saveRollingSummary, loadContextSummary });

module.exports = {
  hushAiChat: chat,
  hushAiSummarize: summarize,
  // Back-compat re-exports for anything importing these directly (tests / demo routes).
  buildSystemPrompt: surveyAgent.buildSystemPrompt,
  validateRequest: (body) => baseValidate(body, surveyAgent.contextKey),
  tools: surveyAgent.tools,
  FIELD_TYPES: surveyAgent.FIELD_TYPES,
  FIELD_TYPE_HINTS: surveyAgent.FIELD_TYPE_HINTS,
};
