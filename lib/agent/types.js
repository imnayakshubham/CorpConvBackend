// lib/agent/types.js — the FeaturePlugin contract (JSDoc).
//
// A FeaturePlugin is the ONLY thing a feature (survey, poll, post, …) supplies to the
// generic harness. Everything domain-specific lives here; nothing survey-specific
// leaks into lib/agent/*. The orchestrator drives these hooks; the route factory mounts
// the handlers. To add a feature: implement this shape and create its routes.
//
// @typedef {Object} PlanSection
// @property {string} title
// @property {string} [brief]
// @property {number} [count]   - desired item count for this section
//
// @typedef {Object} AgentPlan
// @property {string} title
// @property {string} description
// @property {PlanSection[]} sections
//
// @typedef {Object} ToolCall
// @property {string} tool       - tool name the frontend understands (e.g. 'generate_survey')
// @property {object} input      - tool input payload
//
// @typedef {Object} FeaturePlugin
// @property {string} key                       - route + log + persistence namespace ('survey')
// @property {string} domainNoun                - human noun for narration ('survey')
// @property {string} contextKey                - request-body field carrying state ('surveyContext')
// @property {string} [brandName]               - brand used in error copy (defaults to config.BRAND_NAME)
// @property {(ctx: object) => (string|null)} validateContext
// @property {(ctx: object) => string} buildSystemPrompt
// @property {object} tools                     - AI SDK tool catalogue (inputSchema, not parameters)
// @property {string} [extractionSystem]        - D&C extraction system prompt
// @property {(messages: any[], ctx: object) => boolean} wantsLargeBuild
// @property {string} summarySystem
//
// Multi-agent build pipeline (used when wantsLargeBuild is true):
// @property {{ system: string, buildPrompt: (userMessage: string, ctx: object) => string,
//             parse: (text: string, ctx: object) => AgentPlan, maxOutputTokens?: number }} planner
// @property {{ system: string,
//             buildPrompt: (plan: AgentPlan, section: PlanSection, index: number, ctx: object, critique?: string) => string,
//             parse: (text: string, index: number) => any, maxOutputTokens?: number }} worker
// @property {{ system: string,
//             buildPrompt: (plan: AgentPlan, section: PlanSection, index: number, produced: any, ctx: object) => string,
//             parse: (text: string) => { ok: boolean, issues?: string }, maxOutputTokens?: number }} [critic]
// @property {(plan: AgentPlan, producedSections: any[], ctx: object) => ToolCall[]} assemble
//     Returns ordered tool calls; index 0 is the create/replace call, the rest are additive.

module.exports = {}; // types-only module
