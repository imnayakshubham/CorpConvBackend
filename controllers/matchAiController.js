// matchAiController.js — thin shim mounting the Match question-builder plugin on the
// generic agent harness (lib/agent/*). Mirrors companionAiController.js. All AI logic is generic;
// the match-specific behavior lives in features/matchAgent.js.

const { createAgentHandlers } = require('../lib/agent/routeFactory');
const matchAgent = require('../features/matchAgent');
const { saveRollingSummary, loadContextSummary } = require('./hushAiConversationController');

const { chat, summarize } = createAgentHandlers(matchAgent, { saveRollingSummary, loadContextSummary });

module.exports = { matchAiChat: chat, matchAiSummarize: summarize };
