// lib/agent/windowing.js — framework-neutral conversation history windowing.

const { estimateTokens } = require('./pacing');

// Keep the most recent turns that fit the history budget. UI messages carry their
// tool-call AND tool-result parts inside a single assistant message, so windowing
// whole messages never orphans a tool result. We also drop any leading non-user
// messages so the kept window opens on a user turn.
function trimMessagesToBudget(messages, historyBudget) {
  if (!Array.isArray(messages) || messages.length <= 1) return messages;

  const kept = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateTokens(messages[i]);
    if (kept.length > 0 && used + cost > historyBudget) break;
    kept.unshift(messages[i]);
    used += cost;
  }
  if (kept.length === messages.length) return messages; // everything fit — keep as-is
  // We dropped older messages, so open the window on a user turn.
  while (kept.length > 1 && kept[0]?.role !== 'user') kept.shift();
  return kept;
}

module.exports = { trimMessagesToBudget };
