// Thin shim mounting the Litmus question-builder plugin on the harness. All AI logic is
// generic; the litmus behaviour lives in ../agents/litmus.js.

const { createAgentHandlers } = require('../orchestrator/routeFactory');
const litmusAgent = require('../agents/litmus');
const { saveRollingSummary, loadContextSummary } = require('./hushAiConversationController');

const { chat, summarize } = createAgentHandlers(litmusAgent, { saveRollingSummary, loadContextSummary });

module.exports = { litmusAiChat: chat, litmusAiSummarize: summarize };
