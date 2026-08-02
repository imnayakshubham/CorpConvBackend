// First-draft question set for a newly created litmus.
//
// Runs once at creation so the builder is never an empty page. The creator then edits freely,
// or asks Hush AI for changes through the usual approve-before-apply loop.

const engine = require('../adapter');
const { extractJson } = require('../core/json');
const { PAGE_MAX_OUTPUT_TOKENS } = require('../core/config');
const { Litmus } = require('../../models/litmusModel');

const SYSTEM = [
    'You build EVALUATIONS: short question sets that test how well each respondent fits a described need.',
    'Every answer is later scored 0-10 against the criteria, so each question must produce something worth scoring.',
    '',
    'Rules:',
    '- Produce EXACTLY the number of questions requested. No more, no fewer.',
    '- Each question must probe the needs and at least one criterion. No redundant or off-topic questions.',
    '- Pick the best format per question:',
    '  "text" for nuanced open judgement (the default when in doubt),',
    '  "single_choice" for a clear choice between 2-5 concrete options,',
    '  "rating" for degree or frequency, with a real scale and short end labels.',
    '- Respondents answer one question at a time, so each must stand on its own. No "as above".',
    '- Never put the raw needs or criteria into a question. The respondent must not see the rubric.',
    '- Give each question a one-line "rationale" tying it to the needs or criteria. Creator-only.',
    '',
    'Output ONLY minified JSON, no prose, no markdown:',
    '{"questions":[{"text":"...","type":"text|single_choice|rating","options":["..."],',
    '"rating_scale":{"min":1,"max":5,"min_label":"...","max_label":"..."},"rationale":"..."}]}',
    'Include "options" only for single_choice and "rating_scale" only for rating.',
].join('\n');

function buildPrompt({ title, needs_description, evaluation_criteria, max_questions }) {
    const criteria = (evaluation_criteria || []).filter(Boolean);
    return [
        `# Title\n${title}`,
        `\n# What the creator is evaluating for\n${needs_description}`,
        `\n# Criteria\n${criteria.length ? criteria.map((c, i) => `  ${i + 1}. ${c}`).join('\n') : '  (none given - infer sensible ones from the needs)'}`,
        `\nWrite EXACTLY ${max_questions} questions. Return the JSON now.`,
    ].join('\n');
}

const TYPES = ['text', 'single_choice', 'rating'];

// Models reach for typographic dashes and hyphens; house style uses a plain one.
const clean = (value, max) => String(value ?? '').replace(/[‐-―]/g, '-').trim().slice(0, max);

// The model is prompt-instructed rather than schema-bound, so treat every field as untrusted
// and fall back to a plain text question rather than dropping the item.
function normalize(raw, order) {
    const text = clean(raw?.text, 1000);
    if (!text) return null;

    const type = TYPES.includes(raw.type) ? raw.type : 'text';
    const q = { text, type, rationale: clean(raw.rationale, 400), is_required: true, order };

    if (type === 'single_choice') {
        const options = (Array.isArray(raw.options) ? raw.options : [])
            .map((o) => clean(o, 200))
            .filter(Boolean)
            .slice(0, 5);
        if (options.length < 2) return { ...q, type: 'text' };
        q.options = options;
    }

    if (type === 'rating') {
        const min = Number(raw.rating_scale?.min);
        const max = Number(raw.rating_scale?.max);
        if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return { ...q, type: 'text' };
        q.rating_scale = {
            min,
            max,
            min_label: clean(raw.rating_scale.min_label, 60),
            max_label: clean(raw.rating_scale.max_label, 60),
        };
    }

    return q;
}

/**
 * Draft the question set for `litmus` and save it. Never throws: callers fire this without
 * awaiting, and a failure just leaves the builder in its "generation failed" state.
 */
async function generateQuestions(litmus) {
    try {
        const { text } = await engine.complete({
            system: SYSTEM,
            prompt: buildPrompt(litmus),
            maxOutputTokens: PAGE_MAX_OUTPUT_TOKENS,
        });

        const parsed = extractJson(text) || {};
        const questions = (Array.isArray(parsed.questions) ? parsed.questions : [])
            .map(normalize)
            .filter(Boolean)
            .slice(0, litmus.max_questions)
            .map((q, i) => ({ ...q, order: i }));

        // Publishing needs two questions, so anything less is not a usable draft.
        if (questions.length < 2) {
            await Litmus.updateOne({ _id: litmus._id }, { generation_status: 'failed' });
            return;
        }

        await Litmus.updateOne({ _id: litmus._id }, { questions, generation_status: 'ready' });
    } catch (err) {
        console.error('[litmus] generateQuestions error:', err.message);
        await Litmus.updateOne({ _id: litmus._id }, { generation_status: 'failed' }).catch(() => {});
    }
}

module.exports = { generateQuestions };
