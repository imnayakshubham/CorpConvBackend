// lib/agent/orchestrator.js — the supervisor + multi-agent pipelines.
//
// Drives a turn through the harness layers using ONLY the engine port + plugin hooks
// (no `ai` import). Two paths:
//   • Edit / chat  → the agentic tool loop (engine.streamAgent), streamed to the client.
//   • Large build  → planner → parallel worker sub-agents → critic reflection → assemble,
//                    streamed as the same tool-call wire format the client already reads.

const { randomUUID } = require('crypto');
const {
  REQUEST_TOKEN_BUDGET, MODEL_TPM_LIMIT, TPM_MARGIN,
  NORMAL_MAX_OUTPUT_TOKENS, PLANNER_MAX_OUTPUT_TOKENS, PAGE_MAX_OUTPUT_TOKENS,
  CRITIC_MAX_OUTPUT_TOKENS, MAX_STEPS, BRAND_NAME,
} = require('./config');
const { estimateTokens, createTokenPacer, callWithRetry } = require('./pacing');
const { trimMessagesToBudget } = require('./windowing');
const { toClientErrorMessage } = require('./errors');
const { applyDivideAndConquer } = require('./largeInput');
const { extractUserText, lastUserMessage } = require('./messages');

// ─── build pipeline: sub-agent steps ─────────────────────────────────────────────

async function planBuild(engine, plugin, userMessage, context, pacer, abortSignal) {
  const { system } = plugin.planner;
  const prompt = plugin.planner.buildPrompt(userMessage, context);
  const estOut = plugin.planner.maxOutputTokens || PLANNER_MAX_OUTPUT_TOKENS;
  const result = await callWithRetry(
    () => engine.complete({ role: 'planner', system, prompt, abortSignal, temperature: 0.4, maxOutputTokens: estOut }),
    { pacer, estIn: estimateTokens(system) + estimateTokens(prompt), estOut },
  );
  return plugin.planner.parse(result.text, context);
}

async function generateSection(engine, plugin, plan, section, i, context, pacer, abortSignal, critique) {
  const { system } = plugin.worker;
  const prompt = plugin.worker.buildPrompt(plan, section, i, context, critique);
  const estOut = plugin.worker.maxOutputTokens || PAGE_MAX_OUTPUT_TOKENS;
  const result = await callWithRetry(
    () => engine.complete({ role: 'primary', system, prompt, abortSignal, temperature: 0.4, maxOutputTokens: estOut }),
    { pacer, estIn: estimateTokens(system) + estimateTokens(prompt), estOut },
  );
  return plugin.worker.parse(result.text, i);
}

async function critiqueSection(engine, plugin, plan, section, i, produced, context, pacer, abortSignal) {
  const { system } = plugin.critic;
  const prompt = plugin.critic.buildPrompt(plan, section, i, produced, context);
  const estOut = plugin.critic.maxOutputTokens || CRITIC_MAX_OUTPUT_TOKENS;
  const result = await callWithRetry(
    () => engine.complete({ role: 'critic', system, prompt, abortSignal, temperature: 0.2, maxOutputTokens: estOut }),
    { pacer, estIn: estimateTokens(system) + estimateTokens(prompt), estOut },
  );
  return plugin.critic.parse(result.text);
}

// One section end-to-end: generate, then (optionally) critique and revise ONCE.
// Critic failure is non-fatal — we keep the first draft.
async function buildSection(engine, plugin, plan, section, i, context, pacer, abortSignal) {
  let produced = await generateSection(engine, plugin, plan, section, i, context, pacer, abortSignal, null);
  if (plugin.critic && !abortSignal.aborted) {
    try {
      const review = await critiqueSection(engine, plugin, plan, section, i, produced, context, pacer, abortSignal);
      if (review && review.ok === false && review.issues && !abortSignal.aborted) {
        const revised = await generateSection(engine, plugin, plan, section, i, context, pacer, abortSignal, review.issues);
        const nonEmpty = Array.isArray(revised) ? revised.length > 0 : !!revised;
        if (nonEmpty) produced = revised;
      }
    } catch (err) {
      if (!abortSignal.aborted) {
        console.error(`[agent:${plugin.key}] critic failed for section ${i}, keeping first draft:`, err?.message || err);
      }
    }
  }
  return produced;
}

// ─── path: large multi-agent build ───────────────────────────────────────────────

function streamBuildPipeline({ engine, plugin, messages, context, res, abortSignal }) {
  const brand = plugin.brandName || BRAND_NAME;
  const userMessage = extractUserText(lastUserMessage(messages));

  const stream = engine.createUIStream({
    onError: (error) => {
      if (!abortSignal.aborted) console.error(`[agent:${plugin.key}] build error:`, error?.message || error);
      return toClientErrorMessage(error, brand);
    },
    execute: async ({ writer }) => {
      const pacer = createTokenPacer();
      const textId = randomUUID();
      writer.write({ type: 'text-start', id: textId });
      const say = (delta) => writer.write({ type: 'text-delta', id: textId, delta });
      const emitTool = (toolName, input) => {
        const toolCallId = `srv_${randomUUID()}`;
        // tool-input-start must precede tool-input-available; no tool-output part —
        // the client resolves the call itself (tools have no execute on the client).
        writer.write({ type: 'tool-input-start', toolCallId, toolName });
        writer.write({ type: 'tool-input-available', toolCallId, toolName, input });
      };

      say('Putting together the structure…');
      const plan = await planBuild(engine, plugin, userMessage, context, pacer, abortSignal);
      if (abortSignal.aborted) return;

      // Worker sub-agents run in parallel; each self-corrects via the critic loop.
      // A worker that fails yields null rather than killing the build — assemble skips it,
      // and the user reviews a partial draft instead of losing the whole turn.
      say(' Drafting the sections…');
      const settled = await Promise.allSettled(
        plan.sections.map((section, i) => buildSection(engine, plugin, plan, section, i, context, pacer, abortSignal)),
      );
      if (abortSignal.aborted) return;

      const failed = [];
      const produced = settled.map((outcome, i) => {
        if (outcome.status === 'fulfilled') return outcome.value;
        failed.push(i);
        console.error(
          `[agent:${plugin.key}] section ${i} ("${plan.sections[i]?.title}") failed:`,
          outcome.reason?.message || outcome.reason,
        );
        return null;
      });
      if (failed.length === plan.sections.length) {
        throw new Error(`every section failed to draft (${failed.length}/${plan.sections.length})`);
      }
      if (failed.length) {
        const names = failed.map((i) => `"${plan.sections[i]?.title}"`).join(', ');
        say(` Couldn't draft ${names} — left ${failed.length === 1 ? 'it' : 'them'} empty for you to fill in.`);
      }

      // Assemble → ordered tool calls (index 0 creates, the rest are additive).
      const toolCalls = plugin.assemble(plan, produced, context) || [];
      toolCalls.forEach((tc, idx) => {
        if (idx === 0) {
          emitTool(tc.tool, tc.input);
          const n = plan.sections.length;
          say(` Started "${plan.title}" with ${n} step${n === 1 ? '' : 's'}.`);
        } else {
          say(` Adding section ${idx + 1}…`);
          emitTool(tc.tool, tc.input);
        }
      });

      say(' All set — take a look.');
      writer.write({ type: 'text-end', id: textId });
    },
  });

  engine.pipeUIStream(res, stream);
}

// ─── path: agentic edit / chat loop ───────────────────────────────────────────────

async function streamEditLoop({ engine, plugin, messages, context, res, abortSignal, webSearchEnabled, persistence }) {
  const brand = plugin.brandName || BRAND_NAME;

  // Drop the web-search tool when the user turned the toggle off.
  const tools = (webSearchEnabled === false && plugin.webSearchToolName)
    ? Object.fromEntries(Object.entries(plugin.tools).filter(([name]) => name !== plugin.webSearchToolName))
    : plugin.tools;

  // Rolling summary of older turns (server-managed condensed memory) — injected into the
  // prompt so the model keeps context on long threads without the client ever touching the
  // visible transcript. Refreshed in the background by onEnd below.
  let priorSummary = '';
  let summarizedThrough = 0;
  if (persistence && persistence.loadContextSummary) {
    try {
      const s = await persistence.loadContextSummary({ userId: persistence.userId, featureKey: persistence.featureKey, resourceId: persistence.resourceId });
      priorSummary = (s && s.contextSummary) || '';
      summarizedThrough = (s && s.summarizedThrough) || 0;
    } catch (_) { /* no summary — windowing still bounds context */ }
  }

  // Context layer: build the system prompt, size the static floor, window history.
  // The provider counts prompt + reserved output, so reserve maxOutput against the TPM
  // cap. History shrinks to fit (down to just the last turn) — never forced over the cap.
  const baseSystem = plugin.buildSystemPrompt(context);
  const system = priorSummary
    ? `${baseSystem}\n\n## EARLIER CONVERSATION (condensed memory — treat as established context; don't repeat it back to the user)\n${priorSummary}`
    : baseSystem;
  const staticFloor = estimateTokens(system) + estimateTokens(JSON.stringify(tools));
  const promptCeiling = Math.min(REQUEST_TOKEN_BUDGET, MODEL_TPM_LIMIT - NORMAL_MAX_OUTPUT_TOKENS - TPM_MARGIN);
  const historyBudget = Math.max(0, promptCeiling - staticFloor);
  const windowed = trimMessagesToBudget(messages, historyBudget);

  let modelMessages;
  try {
    modelMessages = await engine.toModelMessages(windowed);
  } catch (_) {
    if (!res.headersSent) res.status(400).json({ error: 'Invalid messages format.' });
    return;
  }

  // Official token reducer (AI SDK pruneMessages): strip stale reasoning and older
  // tool-call/result noise while preserving the most recent turn's tool context.
  // Defensive — fall back to the unpruned set if pruning ever yields nothing.
  if (typeof engine.pruneModelMessages === 'function') {
    try {
      const pruned = engine.pruneModelMessages({
        messages: modelMessages,
        reasoning: 'before-last-message',
        toolCalls: 'before-last-2-messages',
        emptyMessages: 'remove',
      });
      if (Array.isArray(pruned) && pruned.length) modelMessages = pruned;
    } catch (_) { /* keep unpruned on any pruning error */ }
  }

  if (!modelMessages.length) {
    if (!res.headersSent) res.status(400).json({ error: 'No valid messages found.' });
    return;
  }

  const estTotal = staticFloor + estimateTokens(windowed);
  console.log(`[agent:${plugin.key}] est tokens ~${estTotal} (floor ${staticFloor}); kept ${windowed.length}/${messages.length} messages`);

  try {
    const handle = engine.streamAgent({
      role: 'primary',
      system,
      messages: modelMessages,
      tools,
      maxSteps: MAX_STEPS,
      abortSignal,
      temperature: 0.3,
      maxOutputTokens: NORMAL_MAX_OUTPUT_TOKENS,
    });
    // Refresh the rolling summary in the background once the stream ends (invisible to the
    // user; the visible transcript is persisted separately by the client).
    const onEnd = (persistence && persistence.saveRollingSummary)
      ? ({ messages: finalMessages }) => {
          refreshRollingSummary({ engine, plugin, persistence, finalMessages, priorSummary, summarizedThrough })
            .catch((e) => console.error(`[agent:${plugin.key}] summary refresh error:`, e?.message || e));
        }
      : undefined;
    engine.pipeAgentResult(res, handle, {
      onError: (error) => {
        if (!abortSignal.aborted) console.error(`[agent:${plugin.key}] stream error:`, error?.message || error);
        return toClientErrorMessage(error, brand);
      },
      ...(onEnd ? { originalMessages: messages, onEnd } : {}),
    });
  } catch (err) {
    if (abortSignal.aborted) return;
    console.error(`[agent:${plugin.key}] stream setup error:`, err);
    if (!res.headersSent) res.status(500).json({ error: toClientErrorMessage(err, brand) });
    else { try { res.end(); } catch (_) { /* noop */ } }
  }
}

// Extract plain text from a UI message (string content or text parts).
function uiText(msg) {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  return (msg.parts || [])
    .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join(' ');
}

// Fold turns older than the live window into a rolling summary (server-side, invisible).
// Incremental: summarize only the newly-aged turns on top of the prior summary. Best-effort —
// a failure just means context relies on windowing; it never affects the user's transcript.
async function refreshRollingSummary({ engine, plugin, persistence, finalMessages, priorSummary, summarizedThrough }) {
  if (!Array.isArray(finalMessages) || !plugin.summarySystem) return;
  const KEEP_RECENT = 8;                       // most recent turns stay verbatim in the window
  const cutoff = finalMessages.length - KEEP_RECENT;
  const start = Math.max(0, summarizedThrough || 0);
  if (cutoff - start < 4) return;              // not enough newly-aged turns to bother
  const newlyAged = finalMessages.slice(start, cutoff);
  const asText = newlyAged
    .map((m) => `${m.role}: ${uiText(m)}`.trim())
    .filter((l) => l.length > 6)
    .join('\n');
  if (!asText.trim()) return;
  const prompt = `${priorSummary ? `Summary so far:\n${priorSummary}\n\n` : ''}Newer conversation to fold into the summary:\n${asText}`;
  const { text } = await engine.complete({ role: 'summary', system: plugin.summarySystem, prompt, temperature: 0.3, maxOutputTokens: 400 });
  const summary = (text || '').trim();
  if (!summary) return;
  await persistence.saveRollingSummary({
    userId: persistence.userId,
    featureKey: persistence.featureKey,
    resourceId: persistence.resourceId,
    contextSummary: summary,
    summarizedThrough: cutoff,
  });
}

// ─── supervisor ───────────────────────────────────────────────────────────────────

// Decide the path and run it. `messages` may be rewritten by the Observation layer.
async function handleChat({ engine, plugin, messages, context, res, abortSignal, webSearchEnabled, persistence }) {
  // Observation: divide-and-conquer a very large pasted message before anything else.
  messages = await applyDivideAndConquer({ engine, messages, extractionSystem: plugin.extractionSystem });
  if (abortSignal.aborted) return;

  // Route: a large from-scratch build can't fit one call under the per-minute cap,
  // so run the paced multi-agent pipeline. Edits and small builds take the fast loop.
  if (plugin.wantsLargeBuild && plugin.wantsLargeBuild(messages, context)) {
    console.log(`[agent:${plugin.key}] multi-agent build`);
    streamBuildPipeline({ engine, plugin, messages, context, res, abortSignal });
    return;
  }

  await streamEditLoop({ engine, plugin, messages, context, res, abortSignal, webSearchEnabled, persistence });
}

async function handleSummarize({ engine, plugin, messages, res, abortSignal }) {
  let modelMessages;
  try {
    modelMessages = await engine.toModelMessages(messages);
  } catch (_) {
    if (!res.headersSent) res.status(400).json({ error: 'Invalid messages format.' });
    return;
  }
  if (!modelMessages.length) {
    if (!res.headersSent) res.status(400).json({ error: 'No valid messages found.' });
    return;
  }

  const run = (role) => engine.complete({ role, system: plugin.summarySystem, messages: modelMessages, abortSignal, temperature: 0.3 });
  try {
    let result;
    try {
      result = await run('summary');
    } catch (primaryErr) {
      if (abortSignal.aborted) throw primaryErr;
      console.warn(`[agent:${plugin.key}] summarize primary failed, falling back:`, primaryErr?.message);
      result = await run('summaryFallback');
    }
    if (!res.headersSent) res.json({ summary: (result.text || '').trim() });
  } catch (err) {
    if (abortSignal.aborted) return;
    console.error(`[agent:${plugin.key}] summarize error:`, err);
    if (!res.headersSent) res.status(500).json({ error: 'AI service unavailable. Please try again.' });
  }
}

module.exports = { handleChat, handleSummarize };
