// features/matchAgent.js — the MATCH question-builder FeaturePlugin for the generic
// agent harness. Mirrors features/coachAgent.js: everything match-specific lives here and
// nothing leaks into lib/agent/*.
//
// INVARIANT: mutation tools have NO server `execute`. The server streams tool-input-available;
// the CLIENT applyFn is the executor and the human Apply gate is the only path to real state.
// This is exactly how "AI proposes, user approves" is enforced.

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

    return `You are Hush AI, helping someone build an EVALUATION — a short set of questions used to test how well each respondent matches a described need (a hiring screen, a compatibility check, a culture/roommate/cofounder fit, and so on). The creator will send it to people; every answer is later scored 0-10 against the criteria.

## YOUR JOB
Turn the creator's needs + criteria into a tight, coherent question set, and refine it on request. You change the match ONLY through tool calls, and every change is shown to the creator for approval before it takes effect.

## RULES FOR THE QUESTION SET
- Between 2 and ${maxQ} questions. Never exceed ${maxQ}. Prefer the fewest questions that fully cover the needs.
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

## CURRENT MATCH
Title: ${title}
Needs: ${needs}
Criteria:
${fmtCriteria(ctx.criteria)}
Questions so far (${questions.length}/${maxQ}):
${fmtQuestions(questions)}`;
}

// ── tools (plain JSON-schema inputSchema; NO execute — client applies via the Apply gate) ──
// Factory (not a shared const) so every tool gets its OWN schema object — a shared reference
// across two tools can be $ref-collapsed by the schema converter and confuse the model.
function questionSchema() {
    return {
        type: 'object',
        properties: {
            text: { type: 'string', description: 'REQUIRED. The complete, final question text shown to the respondent — write the real wording, never blank or a placeholder. Self-contained; never contains the criteria.' },
            type: { type: 'string', enum: ['text', 'single_choice', 'rating'], description: 'Best format for this question.' },
            options: { type: 'array', items: { type: 'string' }, description: 'For single_choice: 2-5 concrete, real answer options (never "Option 1"/"Option 2").' },
            rating_scale: {
                type: 'object',
                properties: {
                    min: { type: 'number' },
                    max: { type: 'number' },
                    min_label: { type: 'string' },
                    max_label: { type: 'string' },
                },
                required: ['min', 'max'],
                additionalProperties: false,
                description: 'For rating: numeric scale with short end labels.',
            },
            rationale: { type: 'string', description: 'One line: how this question ties to the needs/criteria. Creator-only.' },
            is_required: { type: 'boolean', description: 'Whether an answer is required. Default true.' },
        },
        required: ['text', 'type'],
        additionalProperties: false,
    };
}

const tools = {
    generate_questions: {
        description: 'Create or completely replace the question set. Use for the first draft or when the creator asks to redo everything. Provide 2 to the max coherent, interrelated questions with the best format each.',
        inputSchema: {
            type: 'object',
            properties: {
                questions: { type: 'array', items: questionSchema(), minItems: 2, maxItems: 20, description: 'The full ordered question list.' },
            },
            required: ['questions'],
            additionalProperties: false,
        },
    },
    update_question: {
        description: 'Update ONE existing question, identified by its 1-based number in the current list. Only include the fields that change.',
        inputSchema: {
            type: 'object',
            properties: {
                index: { type: 'number', description: '1-based position of the question to update.' },
                text: { type: 'string' },
                type: { type: 'string', enum: ['text', 'single_choice', 'rating'] },
                options: { type: 'array', items: { type: 'string' } },
                rating_scale: {
                    type: 'object',
                    properties: { min: { type: 'number' }, max: { type: 'number' }, min_label: { type: 'string' }, max_label: { type: 'string' } },
                    required: ['min', 'max'],
                    additionalProperties: false,
                },
                rationale: { type: 'string' },
                is_required: { type: 'boolean' },
            },
            required: ['index'],
            additionalProperties: false,
        },
    },
    add_question: {
        description: 'Add ONE new, fully-written question to the end of the set (respecting the max). You MUST include the real question "text" (and options for single_choice / a scale for rating) — never add a blank placeholder.',
        inputSchema: questionSchema(),
    },
    remove_question: {
        description: 'Remove ONE question by its 1-based number.',
        inputSchema: {
            type: 'object',
            properties: { index: { type: 'number', description: '1-based position of the question to remove.' } },
            required: ['index'],
            additionalProperties: false,
        },
    },
    set_details: {
        description: 'Refine the match title, the needs description, or the evaluation criteria.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                needs_description: { type: 'string' },
                evaluation_criteria: { type: 'array', items: { type: 'string' }, description: 'The full replacement list of criteria.' },
            },
            additionalProperties: false,
        },
    },
    suggest_followups: {
        description: 'Offer 2–3 short next things the creator might ask you to do. Non-mutating.',
        inputSchema: {
            type: 'object',
            properties: { suggestions: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 } },
            required: ['suggestions'],
            additionalProperties: false,
        },
    },
};

function validateContext(ctx) {
    if (ctx != null && typeof ctx !== 'object') return 'matchContext must be an object when provided.';
    return null;
}

const SUMMARY_SYSTEM =
    'You condense an match-building chat into a short recap so it can continue with less history. ' +
    'Write 2-4 plain sentences, third person, covering what the match is for, the criteria, and the ' +
    'key decisions made about the questions. No preamble, no markdown. Never mention how the assistant works internally.';

/** @type {import('../lib/agent/types').FeaturePlugin} */
module.exports = {
    key: 'match',
    domainNoun: 'match',
    contextKey: 'matchContext',
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
