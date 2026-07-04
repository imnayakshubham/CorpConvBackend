// lib/agent/engine/port.js — the framework-agnostic engine contract.
//
// The migration seam: the orchestrator, route factory, and plugins depend only on this
// interface, never on `ai`/`@ai-sdk/*`. The Vercel SDK is one adapter (vercelAdapter.js);
// a future LangGraph adapter implements the same methods and is picked via AGENT_ENGINE.
//
// Methods every adapter must implement:
//   getModel(role)              → model for a logical role ('primary'|'fast'|'planner'|'critic')
//   streamAgent(opts)           → streaming tool loop; pipe with pipeAgentResult
//   complete(opts)              → one-shot { text, usage } for sub-agents
//   toModelMessages(messages)   → UI messages → provider model messages
//   createUIStream(opts)        → hand-authored UI message stream (chunked build)
//   pipeUIStream(res, stream)   → pipe a createUIStream() stream to the response
//   pipeAgentResult(res, h, o)  → pipe a streamAgent() handle to the response

const REQUIRED = [
  'getModel', 'streamAgent', 'complete', 'toModelMessages',
  'createUIStream', 'pipeUIStream', 'pipeAgentResult',
];

function assertEngine(engine, name = 'engine') {
  const missing = REQUIRED.filter((m) => typeof engine?.[m] !== 'function');
  if (missing.length) {
    throw new Error(`Agent ${name} is missing required method(s): ${missing.join(', ')}`);
  }
  return engine;
}

module.exports = { REQUIRED, assertEngine };
