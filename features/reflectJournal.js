// features/reflectJournal.js — the AI reflection engine.
//
// One-shot structured extraction over a journal entry, using the generic engine's complete().
// Warm and non-clinical: emotions + themes + a single gentle insight. Model-agnostic (engine
// port), so it swaps providers via env with no change here.

const { extractJson } = require('../lib/agent/json');

const SYSTEM =
    'You are a gentle, perceptive reflection assistant reading a personal journal entry. ' +
    'Output ONLY minified JSON, no prose, matching: {"emotions":string[],"themes":string[],"insight":string}. ' +
    'emotions: 1-4 feeling words actually present in the entry, lowercase (e.g. "anxious","hopeful","tired"). ' +
    'themes: 1-3 short lowercase topic tags (e.g. "work","relationships","health","sleep","money"). ' +
    'insight: ONE warm, non-judgmental sentence that names the core feeling or a pattern you notice — ' +
    'never advice, never clinical, under 140 characters. ' +
    'If the entry is empty or trivial, return {"emotions":[],"themes":[],"insight":""}. Never mention that you are an AI or how you work.';

function cleanList(arr, n) {
    if (!Array.isArray(arr)) return [];
    return arr
        .filter((x) => typeof x === 'string')
        .map((x) => x.trim().toLowerCase().slice(0, 40))
        .filter(Boolean)
        .slice(0, n);
}

async function reflectJournal(engine, text) {
    const prompt = `Journal entry:\n"""\n${String(text || '').slice(0, 4000)}\n"""`;
    const result = await engine.complete({ role: 'extract', system: SYSTEM, prompt, temperature: 0.3, maxOutputTokens: 300 });
    const parsed = extractJson(result.text) || {};
    return {
        emotions: cleanList(parsed.emotions, 4),
        themes: cleanList(parsed.themes, 3),
        insight: typeof parsed.insight === 'string' ? parsed.insight.trim().slice(0, 200) : '',
    };
}

module.exports = { reflectJournal };
