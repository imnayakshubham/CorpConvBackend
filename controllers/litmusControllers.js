const { Litmus, LitmusSubmission } = require('../models/litmusModel');
const { encryptCodes, decryptCodes, verifyPin: litmusAccessCode } = require('../utils/pinCrypto');
const { evaluateSubmission } = require('../ai/runners/litmusEvaluator');

// ── helpers ────────────────────────────────────────────────────────────────────────
const ok = (res, data, message, code = 200) => res.status(code).json({ status: 'Success', data, message });
const fail = (res, code, message) => res.status(code).json({ status: 'Failed', data: null, message });

const uid = (req) => (req.user ? (req.user._id || req.user.id) : null);
const isOwner = (litmus, req) => {
    const requester = uid(req);
    return requester && litmus.created_by.toString() === requester.toString();
};

// Strip encrypted access codes before responding.
function safeLitmus(litmus) {
    const obj = litmus.toObject ? litmus.toObject() : { ...litmus };
    delete obj.pins;
    return obj;
}

// The respondent-facing shape: no rubric (needs/criteria), no rationale, no PINs.
function publicView(litmus, submissionCount) {
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
        questions: (litmus.questions || []).map((q) => ({
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

function computeAccepting(litmus, submissionCount) {
    if (litmus.status !== 'published') return { accepting_responses: false, closed_reason: 'unavailable' };
    const closesAt = litmus.response_settings?.closes_at;
    if (closesAt && new Date(closesAt) < new Date()) return { accepting_responses: false, closed_reason: 'ended' };
    const max = litmus.response_settings?.max_responses;
    const count = submissionCount ?? litmus.submission_count ?? 0;
    if (max && count >= max) return { accepting_responses: false, closed_reason: 'full' };
    return { accepting_responses: true, closed_reason: null };
}

// ── create / edit / list / delete ───────────────────────────────────────────────────
const createLitmus = async (req, res) => {
    try {
        const { title, needs_description, evaluation_criteria = [], max_questions = 8 } = req.body;
        const litmus = new Litmus({
            created_by: uid(req),
            title,
            needs_description,
            evaluation_criteria,
            max_questions,
            status: 'draft',
        });
        await litmus.save();
        return ok(res, safeLitmus(litmus), 'Litmus created', 201);
    } catch (error) {
        console.error('createLitmus error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

const editLitmus = async (req, res) => {
    try {
        const litmus = await Litmus.findOne({ _id: req.params.id, access: true }).select('+pins');
        if (!litmus) return fail(res, 404, 'Litmus not found');
        if (!isOwner(litmus, req)) return fail(res, 403, 'Only the creator can edit this litmus');

        const {
            title, needs_description, evaluation_criteria, max_questions,
            questions, status, pin_enabled, pins, response_settings,
        } = req.body;

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

        const rows = await Litmus.find(query)
            .sort({ createdAt: -1 })
            .limit(limit + 1)
            .select('-pins')
            .lean();

        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore ? items[items.length - 1].createdAt : null;

        // Per-litmus "new responses" = submissions received since the creator last opened results.
        // Small owner-scoped page, so a bounded fan-out of counts is fine.
        await Promise.all(items.map(async (m) => {
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
        const litmus = await Litmus.findOne({ _id: req.params.id, access: true }).select('+pins').lean();
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
        const litmus = await Litmus.findOne({ slug: req.params.slug, access: true }).lean();
        if (!litmus) return fail(res, 404, 'Litmus not found');

        // Drafts/archived are not publicly viewable (only the creator can preview via owner route).
        if (litmus.status !== 'published') {
            const requester = uid(req);
            const owner = requester && litmus.created_by.toString() === requester.toString();
            if (!owner) return fail(res, 404, 'Litmus not found');
        }

        return ok(res, publicView(litmus, litmus.submission_count), 'Litmus fetched');
    } catch (error) {
        console.error('getLitmusPublic error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

const verifyPin = async (req, res) => {
    try {
        const litmus = await Litmus.findOne({ slug: req.params.slug, access: true }).select('+pins');
        if (!litmus) return fail(res, 404, 'Litmus not found');
        if (!litmus.pin_enabled) return fail(res, 400, 'This litmus is not PIN protected');

        const litmused = await litmusAccessCode(req.body.pin, { pins: litmus.pins });
        if (!litmused) return fail(res, 401, 'Invalid PIN');
        return ok(res, { valid: true }, 'PIN verified');
    } catch (error) {
        console.error('verifyPin error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

// ── submit + evaluate ────────────────────────────────────────────────────────────────
const submitLitmus = async (req, res) => {
    try {
        const litmus = await Litmus.findOne({ slug: req.params.slug, access: true }).select('+pins');
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
        const litmus = await Litmus.findOne({ _id: req.params.id, access: true }).lean();
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

const deleteLitmus = async (req, res) => {
    try {
        const litmus = await Litmus.findOne({ _id: req.params.id, access: true });
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
    editLitmus,
    listLitmus,
    getLitmusOwner,
    getLitmusPublic,
    verifyPin,
    submitLitmus,
    getSubmissions,
    reEvaluateSubmission,
    deleteLitmus,
};
