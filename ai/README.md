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

Zero changes to `core/`, `adapter/`, or `orchestrator/`.
