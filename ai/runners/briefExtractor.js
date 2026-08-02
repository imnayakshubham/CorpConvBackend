// Turn a free-text description into the fields a create form would have asked for.
//
// Feature-agnostic: the caller passes a spec saying which fields to pull out and how to
// bound them. Litmus supplies its spec from ai/agents/litmus.js; other features can add
// their own without touching this file.

const engine = require('../adapter');
const { extractJson, clamp } = require('../core/json');
const { NORMAL_MAX_OUTPUT_TOKENS } = require('../core/config');

// A chatty model can run out of tokens mid-object, leaving unparseable JSON. Close what is
// still open and keep the fields it did finish, rather than losing the whole extraction.
function parseMaybeTruncated(reply) {
    const direct = extractJson(reply);
    if (direct) return direct;

    if (typeof reply !== 'string') return null;
    const start = reply.indexOf('{');
    if (start === -1) return null;

    const src = reply.slice(start);
    const stack = [];
    let inString = false;
    let escaped = false;
    // The last point where the JSON was structurally complete enough to cut and close.
    let cut = -1;

    for (let i = 0; i < src.length; i++) {
        const c = src[i];

        if (inString) {
            if (escaped) escaped = false;
            else if (c === '\\') escaped = true;
            else if (c === '"') { inString = false; cut = i + 1; }
            continue;
        }

        if (c === '"') { inString = true; continue; }
        if (c === '{' || c === '[') { stack.push(c); continue; }
        if (c === '}' || c === ']') { stack.pop(); cut = i + 1; continue; }
        if (/[\d\w]/.test(c)) cut = i + 1;  // end of a number, true, false or null
    }

    if (cut === -1) return null;

    let out = src.slice(0, cut).replace(/,\s*$/, '');

    // Inside an object the last pair may have been cut off part way. Drop it only when its
    // value is missing or does not parse: `"max_questions":12` is worth keeping, while
    // `"max_questions":` or `"c":fal` is not.
    if (stack[stack.length - 1] === '{') {
        const tail = out.match(/,\s*"[^"]*"\s*(?::\s*([\w.+-]*))?$/);
        if (tail) {
            const value = tail[1];
            let usable = false;
            if (value) { try { JSON.parse(value); usable = true; } catch { /* partial */ } }
            if (!usable) out = out.slice(0, tail.index);
        }
    }

    for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']';

    try {
        return JSON.parse(out);
    } catch {
        return null;
    }
}

// Models reach for typographic dashes and this is user-facing copy.
const clean = (value, max) => String(value ?? '').replace(/[‐-―]/g, '-').trim().slice(0, max);

function describeFields(fields) {
    return Object.entries(fields).map(([name, f]) => {
        const bounds = f.type === 'int' ? ` (a whole number ${f.min} to ${f.max})`
            : f.type === 'string[]' ? ` (up to ${f.max} short lines)`
                : ` (up to ${f.max} characters)`;
        return `- "${name}": ${f.describe}${bounds}`;
    }).join('\n');
}

function shape(fields) {
    const parts = Object.entries(fields).map(([name, f]) => {
        if (f.type === 'string[]') return `"${name}":["...","..."]`;
        if (f.type === 'int') return `"${name}":${f.default ?? f.min}`;
        return `"${name}":"..."`;
    });
    return `{${parts.join(',')}}`;
}

function buildSystem(spec) {
    return [
        `You turn a short description into the setup fields for ${spec.what}.`,
        'The person is in a hurry, so infer sensible values rather than asking for more detail.',
        '',
        'Fields:',
        describeFields(spec.fields),
        '',
        'Rules:',
        '- Use their own words and specifics wherever you can. Do not invent facts they did not imply.',
        '- Keep the title short and recognisable at a glance. No quotes around it.',
        '- Each list item must be distinct and independently checkable. No overlap, no filler.',
        '- If they gave no signal for a field, use a sensible default rather than leaving it blank.',
        '- Be brief. Stay inside the stated sizes: a long answer gets cut off and is worse than a short one.',
        '',
        `Output ONLY minified JSON, no prose, no markdown: ${shape(spec.fields)}`,
    ].join('\n');
}

// Prompt-instructed rather than schema-bound, so every field is untrusted. Coerce toward
// something usable instead of dropping it; the creator edits all of this afterwards.
function normalize(parsed, spec, text) {
    const out = {};

    for (const [name, f] of Object.entries(spec.fields)) {
        const raw = parsed?.[name];

        if (f.type === 'string[]') {
            const seen = new Set();
            out[name] = (Array.isArray(raw) ? raw : [])
                .map((v) => clean(v, f.itemMax || 300))
                .filter((v) => v && !seen.has(v) && (seen.add(v), true))
                .slice(0, f.max);
            continue;
        }

        if (f.type === 'int') {
            const n = Number(raw);
            out[name] = Number.isFinite(n) ? Math.round(clamp(n, f.min, f.max)) : f.default;
            continue;
        }

        out[name] = clean(raw, f.max);
    }

    // Better a rough title than a failed create: fall back to their opening sentence.
    if (spec.titleField && !out[spec.titleField]) {
        const firstSentence = clean(text.split(/[.\n!?]/)[0], spec.fields[spec.titleField].max);
        out[spec.titleField] = firstSentence || 'Untitled';
    }

    return out;
}

/**
 * Extract `spec.fields` from `text`. Returns null when the model gave nothing usable,
 * so the caller can surface a real error rather than creating an empty record.
 */
async function extractBrief(text, spec) {
    try {
        const { text: reply } = await engine.complete({
            role: 'extract',
            system: buildSystem(spec),
            prompt: `${text}\n\nReturn the JSON now.`,
            maxOutputTokens: NORMAL_MAX_OUTPUT_TOKENS,
        });

        const parsed = parseMaybeTruncated(reply);
        if (!parsed) return null;

        const out = normalize(parsed, spec, text);

        // One field decides whether this is worth creating at all.
        if (spec.requiredField && !out[spec.requiredField]) return null;

        return out;
    } catch (err) {
        console.error('[briefExtractor] error:', err.message);
        return null;
    }
}

module.exports = { extractBrief, parseMaybeTruncated };
