# `ai/` — the Hush AI backend

Everything AI lives here. The layers below `agents/` know nothing about surveys, companions,
or litmus; a new feature plugs in by adding one file per layer and changing nothing else.

## Layout

| Directory | What lives here |
|---|---|
| `types/` | The `FeaturePlugin` contract (JSDoc only). |
| `core/` | Harness primitives: config, errors, json, messages, pacing, windowing, largeInput. Pure, no I/O. |
| `adapter/` | The engine seam. `port.js` is the contract; only `vercelAdapter.js` and `registry.js` import the AI SDK. Swap frameworks via `AGENT_ENGINE`. |
| `orchestrator/` | `orchestrator.js` (supervisor + multi-agent build pipeline) and `routeFactory.js` (plugin → Express handlers). |
| `tools/` | One directory per feature, plus `shared/`. Tool definitions only. |
| `agents/` | The `FeaturePlugin`s: `survey.js`, `companion.js`, `litmus.js`. |
| `runners/` | One-shot `engine.complete()` calls — litmus scoring, journal reflection. Not plugins, no tool loop. |
| `controllers/` `routes/` `middleware/` `models/` `scripts/` | The HTTP and persistence surface: thin shims, route stacks, the quota gate, the conversation schema, the monthly quota cron. |

## The invariant

Exactly one tool in this tree has a server-side `execute`: `web_search`. Every mutation tool
deliberately has none — the absence *is* the approval gate. The server cannot change a survey
even if the model asks it to; only the client's Apply action can.

```bash
grep -rn "execute:" ai/tools/     # must return exactly one hit
```

`orchestrator.js` has its own internal writer tool; it is not part of this count.

## The agent and tool census

Topology and the constraints it imposes are documented in the `orchestrator.js` header. This is
the part that drifts: the counts.

### Agents

One supervisor plus nine agent types that make model calls. **Only the primary loop agent gets
tools** — every other one is one-shot text in, text out via `engine.complete()`.

| Agent | Role | Callsite | Tools | Per turn |
|---|---|---|---|---|
| supervisor | — | `orchestrator.js` `handleChat()` | no | routes only, 0 model calls |
| extractor | `extract` | `core/largeInput.js` | no | one per chunk, parallel |
| query rewriter | `fast` | `tools/shared/webSearch.js` | no | 1 per search |
| planner | `planner` | `orchestrator.js` `planBuild()` | no | 1 |
| worker | `primary` | `orchestrator.js` `generateSection()` | no | one per section, parallel |
| critic | `critic` | `orchestrator.js` `critiqueSection()` | no | one per section, ≤1 revision |
| **primary loop** | `primary` | `orchestrator.js` `streamEditLoop()` | **yes** | 1 stream, ≤`MAX_STEPS` |
| summarizer | `summary` → `summaryFallback` | `orchestrator.js` `refreshRollingSummary()` (background) and `handleSummarize()` (endpoint) | no | 1, on `onEnd` |
| litmus evaluator | `critic` (`EVAL_ROLE`) | `runners/litmusEvaluator.js` | no | outside the chat path |
| journal reflector | `extract` | `runners/reflectJournal.js` | no | outside the chat path |

### Model roles

Seven logical roles, each remappable by env in `adapter/registry.js` without touching a callsite:
`primary` (`AGENT_PRIMARY`), `fast` (`AGENT_FAST`), `planner` (`AGENT_PLANNER`, defaults to
primary), `critic` (`AGENT_CRITIC`, defaults to fast), `summary` (`AGENT_SUMMARY`),
`summaryFallback` (always fast), `extract` (`AGENT_EXTRACT`, defaults to fast).

### Tools

34 definitions. 31 mutate; the 3 that don't are `web_search` and the two distinct
`suggest_followups` (survey's and litmus's). That 1-of-34 with an `execute` is the invariant above.

| Plugin | Tools | Breakdown |
|---|---|---|
| survey | 19 | 10 `fields.js`, 6 `structure.js`, `generate_survey`, `suggest_followups`, `web_search` |
| companion | 9 | 3 `capture.js`, 3 `tasks.js`, 3 `direction.js` |
| litmus | 6 | 4 `questions.js`, `set_details`, `suggest_followups` |

### Plugin capability matrix

The fan-out pipeline exists, but only survey uses it. That is why `litmus.js` and `companion.js`
are under 90 lines each.

| | survey | litmus | companion |
|---|---|---|---|
| supplies `planner`/`worker`/`critic` | yes | no | no |
| can take the build path | yes | no (`wantsLargeBuild: () => false`) | no (same) |
| sets `webSearchToolName` | yes | no | no |

### Cost shape

A build with N sections fires 1 planner + N workers + N critics + up to N revisions + 1 summary.
At N=5 that is up to **17 model calls**, serialized through one token pacer — and it bills
**1 quota unit**, because `middleware/aiQuotaMiddleware.js` meters per HTTP request, not per
model call. Worth knowing before putting a new fan-out feature on the free tier.

## Two schema conventions that look like mistakes

- `tools/survey/schema.js` exports `optionItem` and `fieldUpdates` as **single shared
  objects**. Several tools reference the same object so the schema converter can
  `$ref`-collapse them.
- `tools/litmus/schema.js` exports `questionSchema` as a **factory**, so each tool gets its
  own object — a shared reference there confused the model.

Both are intentional and opposite. A content hash cannot tell them apart, so if you refactor
either, assert object identity explicitly.

## Adding a feature

1. `tools/<feature>/` — tool definitions, plain JSON Schema, never Zod. Mutation tools get no `execute`.
2. `agents/<feature>.js` — implement the `FeaturePlugin` contract from `types/types.js`.
3. `controllers/<feature>AiController.js` — `createAgentHandlers(plugin, hooks)`.
4. `routes/<feature>AiRoutes.js` — its own `protect → writeLimiter → aiQuota` stack.
5. Mount it in `index.js`.
6. Update **The agent and tool census** above — tool counts, the capability matrix, and any new
   agent type. Skip this and the numbers are wrong by the next feature.

Zero changes to `core/`, `adapter/`, or `orchestrator/`.
