const { Litmus, LitmusSubmission } = require('../models/litmusModel');
const { encryptCodes, decryptCodes, verifyPin: litmusAccessCode } = require('../utils/pinCrypto');
const { evaluateSubmission } = require('../ai/runners/litmusEvaluator');
const { generateQuestions } = require('../ai/runners/litmusQuestionGenerator');
const { extractBrief } = require('../ai/runners/briefExtractor');
const litmusAgent = require('../ai/agents/litmus');
const { ok, fail } = require('../shared/apiResponse');
const { computeAccepting } = require('../shared/accepting');
const { findByRef: findRef } = require('../shared/findByRef');

// ── helpers ────────────────────────────────────────────────────────────────────────
const uid = (req) => (req.user ? (req.user._id || req.user.id) : null);
const isOwner = (litmus, req) => {
    const requester = uid(req);
    return requester && litmus.created_by.toString() === requester.toString();
};

// Content is frozen once published so nobody answers a moving target.
const CONTENT_FIELDS = ['title', 'needs_description', 'evaluation_criteria', 'max_questions', 'questions'];

const findByRef = (ref) => findRef(Litmus, ref);

// Strip encrypted access codes before responding.
function safeLitmus(litmus) {
    const obj = litmus.toObject ? litmus.toObject() : { ...litmus };
    delete obj.pins;
    return obj;
}

// The respondent-facing shape: no rubric (needs/criteria), no rationale, no PINs.
function publicView(litmus, submissionCount, locked = false) {
    const { accepting_responses, closed_reason } = computeAccepting(litmus, submissionCount);
    return {
        _id: litmus._id,
        slug: litmus.slug,
        title: litmus.title,
        status: litmus.status,
        pin_required: !!litmus.pin_enabled,
        collect_name: litmus.response_settings?.collect_name !== false,
        accepting_responses,
        closed_reason,
        questions: locked ? [] : (litmus.questions || []).map((q) => ({
            _id: q._id,
            text: q.text,
            type: q.type,
            options: q.options,
            rating_scale: q.rating_scale,
            is_required: q.is_required,
            order: q.order,
        })),
    };
}

// ── create / edit / list / delete ───────────────────────────────────────────────────

// Shared by both create paths: save the draft, then draft the questions in the background
// so the builder is never an empty page.
async function saveNewLitmus(fields, req) {
    const litmus = new Litmus({
        created_by: uid(req),
        title: fields.title,
        needs_description: fields.needs_description,
        evaluation_criteria: fields.evaluation_criteria || [],
        max_questions: fields.max_questions || 8,
        status: 'draft',
    });
    await litmus.save();

    generateQuestions(litmus.toObject()).catch((e) =>
        console.error('[litmus] background generation failed:', e.message));

    return litmus;
}

const createLitmus = async (req, res) => {
    try {
        const litmus = await saveNewLitmus(req.body, req);
        return ok(res, safeLitmus(litmus), 'Litmus created', 201);
    } catch (error) {
        console.error('createLitmus error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

// One-box create: a free-text description in, a filled-in draft out.
const quickCreateLitmus = async (req, res) => {
    try {
        const brief = await extractBrief(req.body.prompt, litmusAgent.briefSpec);
        if (!brief) {
            return fail(res, 422, 'Could not make sense of that. Try describing what you are evaluating for in a sentence or two.');
        }

        const litmus = await saveNewLitmus(brief, req);
        return ok(res, safeLitmus(litmus), 'Litmus created', 201);
    } catch (error) {
        console.error('quickCreateLitmus error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

const editLitmus = async (req, res) => {
    try {
        const litmus = await findByRef(req.params.ref).select('+pins');
        if (!litmus) return fail(res, 404, 'Litmus not found');
        if (!isOwner(litmus, req)) return fail(res, 403, 'Only the creator can edit this litmus');

        const {
            title, needs_description, evaluation_criteria, max_questions,
            questions, status, pin_enabled, pins, response_settings,
        } = req.body;

        // A live litmus can't have its content change under people mid-response. Access codes
        // and response limits stay editable so a leaked code can be revoked without taking
        // the link down.
        if (litmus.status === 'published' && CONTENT_FIELDS.some((f) => req.body[f] !== undefined)) {
            return fail(res, 409, 'Unpublish this litmus before editing its questions or criteria');
        }

        if (title !== undefined) litmus.title = title;
        if (needs_description !== undefined) litmus.needs_description = needs_description;
        if (evaluation_criteria !== undefined) litmus.evaluation_criteria = evaluation_criteria;
        if (max_questions !== undefined) litmus.max_questions = max_questions;

        if (questions !== undefined) {
            litmus.questions = questions.map((q, i) => ({
                text: q.text,
                type: q.type,
                options: q.type === 'single_choice' ? q.options : undefined,
                rating_scale: q.type === 'rating' ? q.rating_scale : undefined,
                rationale: q.rationale || '',
                is_required: q.is_required !== false,
                order: q.order ?? i,
            }));
        }

        if (response_settings !== undefined) {
            litmus.response_settings = {
                max_responses: response_settings.max_responses ?? litmus.response_settings?.max_responses ?? null,
                collect_name: response_settings.collect_name ?? litmus.response_settings?.collect_name ?? true,
                closes_at: response_settings.closes_at !== undefined
                    ? (response_settings.closes_at ? new Date(response_settings.closes_at) : null)
                    : (litmus.response_settings?.closes_at ?? null),
            };
        }

        // Access codes: sending `pins` replaces the list; disabling clears it.
        if (pin_enabled !== undefined) {
            litmus.pin_enabled = pin_enabled;
            if (!pin_enabled) litmus.pins = [];
        }
        if (Array.isArray(pins) && (pin_enabled === undefined || pin_enabled)) {
            litmus.pins = encryptCodes(pins);
        }

        if (status !== undefined) {
            if (status === 'published' && (litmus.questions?.length || 0) < 2) {
                return fail(res, 409, 'A litmus needs at least 2 questions to publish');
            }
            litmus.status = status;
        }

        await litmus.save();
        return ok(res, safeLitmus(litmus), 'Litmus saved');
    } catch (error) {
        console.error('editLitmus error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

const listLitmus = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        const cursor = req.query.cursor || null;
        const query = { created_by: uid(req), access: true };
        if (cursor) query.createdAt = { $lt: new Date(cursor) };

        // Owner-scoped list, so the access codes come back decrypted for the share sheet.
        const rows = await Litmus.find(query)
            .sort({ createdAt: -1 })
            .limit(limit + 1)
            .select('+pins')
            .lean();

        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore ? items[items.length - 1].createdAt : null;

        // Per-litmus "new responses" = submissions received since the creator last opened results.
        // Small owner-scoped page, so a bounded fan-out of counts is fine.
        await Promise.all(items.map(async (m) => {
            m.pins = decryptCodes(m.pins);
            if (!m.submission_count) { m.new_responses = 0; return; }
            const since = m.results_viewed_at || new Date(0);
            m.new_responses = await LitmusSubmission.countDocuments({ litmus_id: m._id, createdAt: { $gt: since } });
        }));

        return ok(res, { litmus: items, nextCursor, hasMore }, 'Litmus fetched');
    } catch (error) {
        console.error('listLitmus error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

// Full owner view — decrypted PINs, needs + criteria included.
const getLitmusOwner = async (req, res) => {
    try {
        const litmus = await findByRef(req.params.ref).select('+pins').lean();
        if (!litmus) return fail(res, 404, 'Litmus not found');
        if (!isOwner(litmus, req)) return fail(res, 403, 'Not authorized');

        const decryptedPins = decryptCodes(litmus.pins);
        delete litmus.pins;
        litmus.pins = decryptedPins;
        litmus.submission_count = litmus.submission_count || 0;
        return ok(res, litmus, 'Litmus fetched');
    } catch (error) {
        console.error('getLitmusOwner error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

// Public respondent view — by slug. No rubric, no PINs, no rationale.
const getLitmusPublic = async (req, res) => {
    try {
        const litmus = await findByRef(req.params.slug).lean();
        if (!litmus) return fail(res, 404, 'Litmus not found');

        const owner = isOwner(litmus, req);

        // Drafts/archived are not publicly viewable (only the creator can preview via owner route).
        if (litmus.status !== 'published' && !owner) return fail(res, 404, 'Litmus not found');

        // Hold the questions back until the access code is verified.
        const locked = !!litmus.pin_enabled && !owner;
        return ok(res, publicView(litmus, litmus.submission_count, locked), 'Litmus fetched');
    } catch (error) {
        console.error('getLitmusPublic error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

const verifyPin = async (req, res) => {
    try {
        const litmus = await findByRef(req.params.slug).select('+pins');
        if (!litmus) return fail(res, 404, 'Litmus not found');
        if (!litmus.pin_enabled) return fail(res, 400, 'This litmus is not PIN protected');

        const valid = await litmusAccessCode(req.body.pin, { pins: litmus.pins });
        if (!valid) return fail(res, 401, 'Invalid PIN');

        // The code is the credential, so hand the questions over here rather than
        // making the taker re-fetch a route that would still be locked.
        return ok(res, publicView(litmus, litmus.submission_count), 'PIN verified');
    } catch (error) {
        console.error('verifyPin error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

// ── submit + evaluate ────────────────────────────────────────────────────────────────
const submitLitmus = async (req, res) => {
    try {
        const litmus = await findByRef(req.params.slug).select('+pins');
        if (!litmus) return fail(res, 404, 'Litmus not found');

        const { accepting_responses, closed_reason } = computeAccepting(litmus, litmus.submission_count);
        if (!accepting_responses) {
            const msg = closed_reason === 'full' ? 'This litmus has reached its response limit'
                : closed_reason === 'ended' ? 'This litmus is closed'
                    : 'This litmus is not accepting responses';
            return fail(res, 403, msg);
        }

        if (litmus.pin_enabled) {
            if (!req.body.pin) return fail(res, 401, 'PIN required');
            if (!(await litmusAccessCode(req.body.pin, { pins: litmus.pins }))) return fail(res, 401, 'Invalid PIN');
        }

        // Map submitted answers onto the stored questions (never trust client question text/type).
        const answerByQid = new Map((req.body.responses || []).map((r) => [String(r.question_id), r.answer]));
        const responses = [];
        for (const q of litmus.questions) {
            const raw = answerByQid.has(String(q._id)) ? answerByQid.get(String(q._id)) : null;
            const empty = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');
            if (q.is_required && empty) {
                return fail(res, 400, `Please answer: "${q.text}"`);
            }
            responses.push({ question_id: q._id, question_text: q.text, type: q.type, answer: empty ? null : raw });
        }

        const submission = new LitmusSubmission({
            litmus_id: litmus._id,
            litmus_created_by: litmus.created_by,
            respondent_name: (litmus.response_settings?.collect_name !== false && req.body.respondent_name) ? req.body.respondent_name : '',
            respondent_user: uid(req) || null,
            responses,
            evaluation: { status: 'pending' },
        });
        await submission.save();
        await Litmus.updateOne({ _id: litmus._id }, { $inc: { submission_count: 1 } });

        // Fire-and-forget scoring — never blocks the respondent, never throws into this handler.
        evaluateSubmission(litmus.toObject(), submission).catch((e) =>
            console.error('[litmus] background evaluation failed:', e.message));

        return ok(res, { submitted: true }, 'Response submitted', 201);
    } catch (error) {
        console.error('submitLitmus error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

// ── results (owner) ────────────────────────────────────────────────────────────────
const getSubmissions = async (req, res) => {
    try {
        const litmus = await findByRef(req.params.ref).lean();
        if (!litmus) return fail(res, 404, 'Litmus not found');
        if (!isOwner(litmus, req)) return fail(res, 403, 'Not authorized');

        const submissions = await LitmusSubmission.find({ litmus_id: litmus._id })
            .sort({ 'evaluation.score': -1, createdAt: -1 })
            .lean();

        // Opening results marks them seen, so the "new responses" badge clears on the list.
        Litmus.updateOne({ _id: litmus._id }, { results_viewed_at: new Date() }).catch(() => {});

        const scored = submissions.filter((s) => s.evaluation?.status === 'evaluated' && typeof s.evaluation.score === 'number');
        const avgScore = scored.length
            ? Math.round((scored.reduce((a, s) => a + s.evaluation.score, 0) / scored.length) * 10) / 10
            : null;

        return ok(res, {
            litmus: {
                _id: litmus._id,
                title: litmus.title,
                needs_description: litmus.needs_description,
                evaluation_criteria: litmus.evaluation_criteria,
                questions: litmus.questions,
                submission_count: litmus.submission_count,
            },
            submissions,
            stats: { total: submissions.length, evaluated: scored.length, avgScore },
        }, 'Submissions fetched');
    } catch (error) {
        console.error('getSubmissions error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

const reEvaluateSubmission = async (req, res) => {
    try {
        const submission = await LitmusSubmission.findById(req.params.submissionId);
        if (!submission) return fail(res, 404, 'Submission not found');
        if (submission.litmus_created_by.toString() !== (uid(req) || '').toString()) {
            return fail(res, 403, 'Not authorized');
        }
        const litmus = await Litmus.findById(submission.litmus_id).lean();
        if (!litmus) return fail(res, 404, 'Litmus not found');

        const evaluation = await evaluateSubmission(litmus, submission);
        return ok(res, { evaluation }, 'Submission re-evaluated');
    } catch (error) {
        console.error('reEvaluateSubmission error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

// Retry the first draft after a failed generation. Waits for the result so the creator
// who pressed the button gets a real answer.
const regenerateLitmus = async (req, res) => {
    try {
        const litmus = await findByRef(req.params.ref);
        if (!litmus) return fail(res, 404, 'Litmus not found');
        if (!isOwner(litmus, req)) return fail(res, 403, 'Not authorized');
        if (litmus.status === 'published') return fail(res, 409, 'Unpublish this litmus before regenerating its questions');

        await generateQuestions(litmus.toObject());
        const updated = await Litmus.findById(litmus._id).lean();
        return ok(res, safeLitmus(updated), 'Questions regenerated');
    } catch (error) {
        console.error('regenerateLitmus error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

// Same brief and questions, fresh draft: no slug, no responses, no access codes.
const duplicateLitmus = async (req, res) => {
    try {
        const source = await findByRef(req.params.ref).lean();
        if (!source) return fail(res, 404, 'Litmus not found');
        if (!isOwner(source, req)) return fail(res, 403, 'Not authorized');

        const copy = new Litmus({
            created_by: uid(req),
            title: `${source.title} (copy)`.slice(0, 120),
            needs_description: source.needs_description,
            evaluation_criteria: source.evaluation_criteria,
            max_questions: source.max_questions,
            questions: (source.questions || []).map(({ _id, ...q }) => q),
            response_settings: source.response_settings,
            status: 'draft',
            generation_status: 'ready',
        });
        await copy.save();
        return ok(res, safeLitmus(copy), 'Litmus duplicated', 201);
    } catch (error) {
        console.error('duplicateLitmus error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

const deleteLitmus = async (req, res) => {
    try {
        const litmus = await findByRef(req.params.ref);
        if (!litmus) return fail(res, 404, 'Litmus not found');
        if (!isOwner(litmus, req)) return fail(res, 403, 'Only the creator can delete this litmus');

        litmus.access = false;
        await litmus.save();
        return ok(res, null, 'Litmus deleted');
    } catch (error) {
        console.error('deleteLitmus error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

module.exports = {
    createLitmus,
    quickCreateLitmus,
    editLitmus,
    listLitmus,
    getLitmusOwner,
    getLitmusPublic,
    verifyPin,
    submitLitmus,
    getSubmissions,
    reEvaluateSubmission,
    regenerateLitmus,
    duplicateLitmus,
    deleteLitmus,
};
