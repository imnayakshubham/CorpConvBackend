// The LITMUS question-builder FeaturePlugin. Tools are in ../tools/litmus/.
//
// INVARIANT: mutation tools have NO server `execute`. The server streams tool-input-available;
// the CLIENT applyFn is the executor, so the human Apply gate is the only path to real state.
// That is how "AI proposes, user approves" is enforced.

const tools = require('../tools/litmus');

// ── system prompt ─────────────────────────────────────────────────────────────────
function fmtCriteria(items) {
    if (!items || !items.length) return '  (none specified yet — infer sensible ones from the needs)';
    return items.map((c, i) => `  ${i + 1}. ${c}`).join('\n');
}

function fmtQuestions(questions) {
    if (!questions || !questions.length) return '  (no questions yet — none have been generated)';
    return questions.map((q, i) => {
        const bits = [`  ${i + 1}. [${q.type}] ${q.text}`];
        if (q.type === 'single_choice' && Array.isArray(q.options)) bits.push(`      options: ${q.options.join(' | ')}`);
        if (q.type === 'rating' && q.rating_scale) bits.push(`      scale: ${q.rating_scale.min}–${q.rating_scale.max} (${q.rating_scale.min_label || ''} → ${q.rating_scale.max_label || ''})`);
        return bits.join('\n');
    }).join('\n');
}

function buildSystemPrompt(ctx = {}) {
    const title = ctx.title || '(untitled)';
    const needs = (ctx.needs || '').trim() || '(not described yet)';
    const maxQ = Number.isFinite(ctx.maxQuestions) ? ctx.maxQuestions : 8;
    const questions = Array.isArray(ctx.questions) ? ctx.questions : [];

    return `You are Hush AI, helping someone build an EVALUATION — a short set of questions used to test how well each respondent fits a described need (a hiring screen, a compatibility check, a culture/roommate/cofounder fit, and so on). The creator will send it to people; every answer is later scored 0-10 against the criteria.

## YOUR JOB
Turn the creator's needs + criteria into a tight, coherent question set, and refine it on request. You change the litmus ONLY through tool calls, and every change is shown to the creator for approval before it takes effect.

## RULES FOR THE QUESTION SET
- Count: if the creator asks for a specific number of questions, produce EXACTLY that many — no more, no fewer (capped at ${maxQ}; if they ask for more than ${maxQ}, produce ${maxQ} and say so). Only choose the count yourself when they give no number — then prefer the fewest that fully cover the needs, between 2 and ${maxQ}. Never exceed ${maxQ}.
- Every question must earn its place: each one must probe the needs and at least one criterion. The set should build a coherent picture together — no redundant or off-topic questions, and later questions should complement earlier ones rather than repeat them.
- Choose the best FORMAT per question:
  - "text" — for nuanced, open judgement (experience, reasoning, examples). Default when in doubt.
  - "single_choice" — for a clear either/or or a small set of distinct positions. Provide 2–5 concrete options.
  - "rating" — for degree, comfort, frequency, or intensity. Provide a rating_scale (min/max and short min_label/max_label, e.g. 1–5, "Never"→"Daily").
- Give every question a short "rationale": one line on how it ties to the needs/criteria. This is for the creator only.
- Respondents answer one question at a time, so each question must stand on its own — no "as above" references.
- NEVER put the raw needs or criteria into a question's text; the respondent must not see the rubric.

## HOW TO ACT
- To create or completely redo the set, call generate_questions with the full list.
- To change ONE question the creator points at, call update_question with its number and the new field values.
- Use add_question / remove_question for small edits, and set_details to refine the title, needs, or criteria.
- CRITICAL: whenever you add or update a question, WRITE THE ACTUAL CONTENT. add_question must include the full, final question "text"; for single_choice give 2-5 real options; for rating give a real scale. update_question must include the concrete new values for every field you change. NEVER emit a blank, generic, or placeholder question (no empty text, no "Option 1"/"Option 2").
- Keep chat replies brief and human. Do not describe how you work internally or name any tool or technology.

## CURRENT LITMUS
Title: ${title}
Needs: ${needs}
Criteria:
${fmtCriteria(ctx.criteria)}
Questions so far (${questions.length}/${maxQ}):
${fmtQuestions(questions)}`;
}


function validateContext(ctx) {
    if (ctx != null && typeof ctx !== 'object') return 'litmusContext must be an object when provided.';
    return null;
}

const SUMMARY_SYSTEM =
    'You condense a litmus-building chat into a short recap so it can continue with less history. ' +
    'Write 2-4 plain sentences, third person, covering what the litmus is for, the criteria, and the ' +
    'key decisions made about the questions. No preamble, no markdown. Never mention how the assistant works internally.';

/** @type {import('../types/types').FeaturePlugin} */
module.exports = {
    key: 'litmus',
    domainNoun: 'litmus',
    contextKey: 'litmusContext',
    brandName: 'Hush AI',
    buildSystemPrompt,
    tools,
    validateContext,
    // A focused edit loop — single-tool generation is enough for a short interrelated set.
    wantsLargeBuild: () => false,
    extractionSystem:
        'Extract only what matters for building an evaluation: the need being tested, the criteria, and any constraints on the questions. Be concise.',
    summarySystem: SUMMARY_SYSTEM,
};
