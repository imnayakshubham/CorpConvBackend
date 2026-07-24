// features/matchEvaluator.js — one-shot scoring for a match submission.
//
// Uses the generic agent engine's `complete()` (no tool loop, no streaming, no conversation)
// to score a submission 0-10 against the creator's needs + criteria, produce a short "why", and
// (when criteria are defined) a per-criterion breakdown. Structured output is prompt-instructed
// JSON, parsed defensively with extractJson/clamp.

const engine = require('../lib/agent/engine');
const { extractJson, clamp } = require('../lib/agent/json');
const { roleSpec } = require('../lib/agent/engine/registry');

const EVAL_ROLE = 'critic';

// The output shape depends on whether the creator defined criteria. With criteria, the model must
// return a per-criterion array IN THE SAME ORDER it was given, so we can zip scores back to the
// criterion text by index (robust against the model paraphrasing the criterion).
function systemFor(hasCriteria) {
    const base = [
        'You are an impartial evaluator. You score how well ONE respondent meets a set of needs and criteria,',
        'based only on their answers. Reward specific, relevant evidence; penalise vagueness, gaps, and',
        'answers that miss the point. Be fair, consistent, and concrete - cite what the respondent actually said.',
        'You are a signal for a human reviewer, never a final verdict, and you never invent facts the respondent',
        'did not provide.',
        '',
        'Output ONLY minified JSON, no prose, no markdown.',
    ];
    if (hasCriteria) {
        base.push(
            'Shape: {"score": <overall 0-10, one decimal allowed>, "summary": "<2-3 sentences: main reasons, strengths and gaps>",',
            '"criteria": [{"score": <0-10>, "note": "<one short clause on this criterion>"}]}.',
            'The "criteria" array MUST have exactly one entry per criterion, in the SAME ORDER the criteria are listed.',
        );
    } else {
        base.push('Shape: {"score": <0-10, one decimal allowed>, "summary": "<2-3 sentences: main reasons, strengths and gaps>"}.');
    }
    return base.join('\n');
}

function formatAnswer(r) {
    if (r.answer === null || r.answer === undefined || r.answer === '') return '(no answer)';
    return String(r.answer);
}

function buildPrompt(match, criteriaList, submission) {
    const criteria = criteriaList.length
        ? criteriaList.map((c, i) => `  ${i + 1}. ${c}`).join('\n')
        : '  (no explicit criteria - judge overall fit against the needs)';

    const qa = (submission.responses || [])
        .map((r, i) => `Q${i + 1} (${r.type}): ${r.question_text}\nA${i + 1}: ${formatAnswer(r)}`)
        .join('\n\n');

    return [
        `# What the creator is evaluating for\n${match.needs_description}`,
        `\n# Evaluation criteria\n${criteria}`,
        `\n# The respondent's answers\n${qa}`,
        criteriaList.length
            ? '\nScore this respondent 0-10 overall AND per criterion (same order as listed). Return the JSON now.'
            : '\nScore this respondent 0-10 on how well they meet the needs. Return the JSON now.',
    ].join('\n');
}

// Zip the model's ordered criteria array back onto the criterion text, clamping each sub-score.
function parseCriteriaScores(parsed, criteriaList) {
    if (!criteriaList.length || !Array.isArray(parsed.criteria)) return [];
    return criteriaList.map((criterion, i) => {
        const entry = parsed.criteria[i] || {};
        const raw = Number(entry.score);
        return {
            criterion,
            score: Number.isFinite(raw) ? Math.round(clamp(raw, 0, 10) * 10) / 10 : null,
            note: typeof entry.note === 'string' ? entry.note.trim().slice(0, 300) : '',
        };
    });
}

/**
 * Score a submission and write the result onto `submission.evaluation`, then persist.
 * Never throws — on any failure it records evaluation.status = 'failed' so the respondent flow
 * (which calls this fire-and-forget) is never affected.
 *
 * @param {object} match - lean or hydrated Match (needs needs_description, evaluation_criteria).
 * @param {import('mongoose').Document} submission - hydrated MatchSubmission doc to update.
 * @returns {Promise<object>} the saved evaluation subdocument.
 */
async function evaluateSubmission(match, submission) {
    const criteriaList = Array.isArray(match.evaluation_criteria) ? match.evaluation_criteria.filter(Boolean) : [];
    try {
        const { text } = await engine.complete({
            role: EVAL_ROLE,
            system: systemFor(criteriaList.length > 0),
            prompt: buildPrompt(match, criteriaList, submission),
            temperature: 0.2,
            maxOutputTokens: 600,
        });

        const parsed = extractJson(text) || {};
        const rawScore = Number(parsed.score);
        const score = Number.isFinite(rawScore) ? Math.round(clamp(rawScore, 0, 10) * 10) / 10 : null;
        const summary = typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 1000) : '';

        if (score === null) {
            submission.evaluation = { status: 'failed', evaluated_at: new Date(), model: roleSpec(EVAL_ROLE) };
        } else {
            submission.evaluation = {
                score,
                summary,
                criteria_scores: parseCriteriaScores(parsed, criteriaList),
                status: 'evaluated',
                model: roleSpec(EVAL_ROLE),
                evaluated_at: new Date(),
            };
        }
        await submission.save();
        return submission.evaluation;
    } catch (err) {
        console.error('[match] evaluateSubmission error:', err.message);
        try {
            submission.evaluation = { status: 'failed', evaluated_at: new Date(), model: roleSpec(EVAL_ROLE) };
            await submission.save();
        } catch (_) { /* swallow — nothing more we can do */ }
        return submission.evaluation;
    }
}

module.exports = { evaluateSubmission };
