// hushAiController.js — Hush AI survey assistant.
//
// This is now a THIN SHIM. All AI logic lives in the generic agent harness
// (lib/agent/*) and the survey-specific behavior lives in the survey feature plugin
// (features/surveyAgent.js). The harness is model-agnostic (engine port + provider
// registry) and multi-agent (orchestrator: supervisor → planner → parallel workers →
// critic). To add another feature's assistant, create a sibling plugin + routes —
// see lib/agent/types.js and docs/claude-cowork.md.

const { createAgentHandlers, baseValidate } = require('../lib/agent/routeFactory');
const surveyAgent = require('../features/surveyAgent');
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
