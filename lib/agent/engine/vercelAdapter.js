// lib/agent/engine/vercelAdapter.js — the ONLY module that imports `ai` / `@ai-sdk/*`.
//
// Implements the AgentEngine port (engine/port.js) on the Vercel AI SDK. A future
// LangChain/LangGraph adapter implements the same interface; nothing else in the
// harness changes. The UI-message wire format produced here IS the frontend protocol
// (`useChat`), so any replacement adapter must emit the same stream — it can reuse
// the AI SDK's stream writer for that even if its agent loop runs on another engine.
//
// AI SDK v7 is ESM-only (no CommonJS `require`), so the SDK is loaded via dynamic
// import() and cached at server boot by init() (called from startServer()). Every
// method below reads the cached bindings, so init() MUST resolve before any request
// reaches the engine.

const { getModel, initRegistry } = require('./registry');

// Cached SDK bindings — populated by init().
let sdk = null;

function ensureReady() {
  if (!sdk) throw new Error('Agent engine not initialized — call engine.init() at startup before serving requests.');
  return sdk;
}

// Feature plugins supply tools with PLAIN JSON-schema `inputSchema` (so they never
// import `ai`). Wrap each schema with the SDK's jsonSchema() here, at the boundary.
// Idempotent-ish: a schema that's already wrapped is passed through untouched.
function wrapTools(tools) {
  if (!tools) return tools;
  const { jsonSchema } = ensureReady();
  const out = {};
  for (const [name, tool] of Object.entries(tools)) {
    const schema = tool.inputSchema;
    const alreadyWrapped = schema && typeof schema === 'object' && 'jsonSchema' in schema;
    out[name] = {
      ...tool,
      inputSchema: alreadyWrapped || schema == null ? schema : jsonSchema(schema),
    };
  }
  return out;
}

/** @type {import('./port').AgentEngine} */
const vercelEngine = {
  // Load the ESM-only SDK once and cache the bindings. Idempotent.
  async init() {
    if (sdk) return;
    const ai = await import('ai');
    sdk = {
      streamText: ai.streamText,
      generateText: ai.generateText,
      jsonSchema: ai.jsonSchema,
      convertToModelMessages: ai.convertToModelMessages,
      stepCountIs: ai.stepCountIs,
      pruneMessages: ai.pruneMessages,
      createUIMessageStream: ai.createUIMessageStream,
      pipeUIMessageStreamToResponse: ai.pipeUIMessageStreamToResponse,
    };
    await initRegistry();
  },

  getModel,

  streamAgent({ role = 'primary', system, messages, tools, maxSteps = 8, abortSignal, temperature = 0.3, maxOutputTokens }) {
    const { streamText, stepCountIs } = ensureReady();
    return streamText({
      model: getModel(role),
      system,
      messages,
      tools: wrapTools(tools),
      stopWhen: stepCountIs(maxSteps),
      abortSignal,
      temperature, // low — consistent tool selection, not creativity
      maxOutputTokens, // cap so a runaway single call can't blow the per-minute ceiling
    });
  },

  complete({ role = 'primary', system, prompt, messages, abortSignal, temperature = 0.4, maxOutputTokens }) {
    const { generateText } = ensureReady();
    return generateText({
      model: getModel(role),
      ...(system != null ? { system } : {}),
      ...(messages != null ? { messages } : { prompt }),
      abortSignal,
      temperature,
      ...(maxOutputTokens != null ? { maxOutputTokens } : {}),
    });
  },

  toModelMessages(messages) {
    const { convertToModelMessages } = ensureReady();
    return convertToModelMessages(messages);
  },

  // Official ModelMessage[] pruner (reasoning/tool-call content by age). Used by the
  // context layer to shrink history before the budget trim.
  pruneModelMessages(opts) {
    const { pruneMessages } = ensureReady();
    return pruneMessages(opts);
  },

  createUIStream({ onError, execute }) {
    const { createUIMessageStream } = ensureReady();
    return createUIMessageStream({ onError, execute });
  },

  pipeUIStream(res, stream) {
    const { pipeUIMessageStreamToResponse } = ensureReady();
    return pipeUIMessageStreamToResponse({ response: res, stream });
  },

  // Pipe a streamAgent() handle to the response. Extra UIMessageStreamOptions
  // (originalMessages / onEnd) let the caller observe the final UI messages once the
  // stream ends — used for the best-effort background rolling summary.
  pipeAgentResult(res, handle, { onError, originalMessages, messageMetadata, onEnd } = {}) {
    return handle.pipeUIMessageStreamToResponse(res, {
      onError,
      ...(originalMessages ? { originalMessages } : {}),
      ...(messageMetadata ? { messageMetadata } : {}),
      ...(onEnd ? { onEnd } : {}),
    });
  },
};

module.exports = vercelEngine;
