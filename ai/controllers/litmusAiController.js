// litmusAiController.js — thin shim mounting the Litmus question-builder plugin on the
// generic agent harness (lib/agent/*). Mirrors companionAiController.js. All AI logic is generic;
// the litmus-specific behavior lives in features/litmusAgent.js.

const { createAgentHandlers } = require('../orchestrator/routeFactory');
const litmusAgent = require('../agents/litmus');
const { saveRollingSummary, loadContextSummary } = require('./hushAiConversationController');

const { chat, summarize } = createAgentHandlers(litmusAgent, { saveRollingSummary, loadContextSummary });

module.exports = { litmusAiChat: chat, litmusAiSummarize: summarize };
