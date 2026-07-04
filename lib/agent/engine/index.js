// lib/agent/engine/index.js — selects the active engine adapter.
//
// Flip AGENT_ENGINE to swap the underlying agent framework (e.g. a future
// 'langgraph' adapter) with zero change to the orchestrator, plugins, or frontend.

const { assertEngine } = require('./port');

const ENGINE = process.env.AGENT_ENGINE || 'vercel';

function loadEngine(name) {
  switch (name) {
    case 'vercel':
      return require('./vercelAdapter');
    // case 'langgraph':
    //   return require('./langgraphAdapter');
    default:
      throw new Error(`Unknown AGENT_ENGINE "${name}". Supported: vercel.`);
  }
}

module.exports = assertEngine(loadEngine(ENGINE), `engine "${ENGINE}"`);
