const { Match, MatchSubmission } = require('../models/matchModel');
const { encryptCodes, decryptCodes, verifyPin: matchAccessCode } = require('../utils/pinCrypto');
const { evaluateSubmission } = require('../features/matchEvaluator');

// ── helpers ────────────────────────────────────────────────────────────────────────
const ok = (res, data, message, code = 200) => res.status(code).json({ status: 'Success', data, message });
const fail = (res, code, message) => res.status(code).json({ status: 'Failed', data: null, message });

const uid = (req) => (req.user ? (req.user._id || req.user.id) : null);
const isOwner = (match, req) => {
    const requester = uid(req);
    return requester && match.created_by.toString() === requester.toString();
};

// Strip encrypted access codes before responding.
function safeMatch(match) {
    const obj = match.toObject ? match.toObject() : { ...match };
    delete obj.pins;
    return obj;
}

// The respondent-facing shape: no rubric (needs/criteria), no rationale, no PINs.
function publicView(match, submissionCount) {
    const { accepting_responses, closed_reason } = computeAccepting(match, submissionCount);
    return {
        _id: match._id,
        slug: match.slug,
        title: match.title,
        status: match.status,
        pin_required: !!match.pin_enabled,
        collect_name: match.response_settings?.collect_name !== false,
        accepting_responses,
        closed_reason,
        questions: (match.questions || []).map((q) => ({
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

function computeAccepting(match, submissionCount) {
    if (match.status !== 'published') return { accepting_responses: false, closed_reason: 'unavailable' };
    const closesAt = match.response_settings?.closes_at;
    if (closesAt && new Date(closesAt) < new Date()) return { accepting_responses: false, closed_reason: 'ended' };
    const max = match.response_settings?.max_responses;
    const count = submissionCount ?? match.submission_count ?? 0;
    if (max && count >= max) return { accepting_responses: false, closed_reason: 'full' };
    return { accepting_responses: true, closed_reason: null };
}

// ── create / edit / list / delete ───────────────────────────────────────────────────
const createMatch = async (req, res) => {
    try {
        const { title, needs_description, evaluation_criteria = [], max_questions = 8 } = req.body;
        const match = new Match({
            created_by: uid(req),
            title,
            needs_description,
            evaluation_criteria,
            max_questions,
            status: 'draft',
        });
        await match.save();
        return ok(res, safeMatch(match), 'Match created', 201);
    } catch (error) {
        console.error('createMatch error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

const editMatch = async (req, res) => {
    try {
        const match = await Match.findOne({ _id: req.params.id, access: true }).select('+pins');
        if (!match) return fail(res, 404, 'Match not found');
        if (!isOwner(match, req)) return fail(res, 403, 'Only the creator can edit this match');

        const {
            title, needs_description, evaluation_criteria, max_questions,
            questions, status, pin_enabled, pins, response_settings,
        } = req.body;

        if (title !== undefined) match.title = title;
        if (needs_description !== undefined) match.needs_description = needs_description;
        if (evaluation_criteria !== undefined) match.evaluation_criteria = evaluation_criteria;
        if (max_questions !== undefined) match.max_questions = max_questions;

        if (questions !== undefined) {
            match.questions = questions.map((q, i) => ({
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
            match.response_settings = {
                max_responses: response_settings.max_responses ?? match.response_settings?.max_responses ?? null,
                collect_name: response_settings.collect_name ?? match.response_settings?.collect_name ?? true,
                closes_at: response_settings.closes_at !== undefined
                    ? (response_settings.closes_at ? new Date(response_settings.closes_at) : null)
                    : (match.response_settings?.closes_at ?? null),
            };
        }

        // Access codes: sending `pins` replaces the list; disabling clears it.
        if (pin_enabled !== undefined) {
            match.pin_enabled = pin_enabled;
            if (!pin_enabled) match.pins = [];
        }
        if (Array.isArray(pins) && (pin_enabled === undefined || pin_enabled)) {
            match.pins = encryptCodes(pins);
        }

        if (status !== undefined) {
            if (status === 'published' && (match.questions?.length || 0) < 2) {
                return fail(res, 409, 'An match needs at least 2 questions to publish');
            }
            match.status = status;
        }

        await match.save();
        return ok(res, safeMatch(match), 'Match saved');
    } catch (error) {
        console.error('editMatch error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

const listMatches = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        const cursor = req.query.cursor || null;
        const query = { created_by: uid(req), access: true };
        if (cursor) query.createdAt = { $lt: new Date(cursor) };

        const rows = await Match.find(query)
            .sort({ createdAt: -1 })
            .limit(limit + 1)
            .select('-pins')
            .lean();

        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore ? items[items.length - 1].createdAt : null;

        // Per-match "new responses" = submissions received since the creator last opened results.
        // Small owner-scoped page, so a bounded fan-out of counts is fine.
        await Promise.all(items.map(async (m) => {
            if (!m.submission_count) { m.new_responses = 0; return; }
            const since = m.results_viewed_at || new Date(0);
            m.new_responses = await MatchSubmission.countDocuments({ match_id: m._id, createdAt: { $gt: since } });
        }));

        return ok(res, { matches: items, nextCursor, hasMore }, 'Matches fetched');
    } catch (error) {
        console.error('listMatches error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

// Full owner view — decrypted PINs, needs + criteria included.
const getMatchOwner = async (req, res) => {
    try {
        const match = await Match.findOne({ _id: req.params.id, access: true }).select('+pins').lean();
        if (!match) return fail(res, 404, 'Match not found');
        if (!isOwner(match, req)) return fail(res, 403, 'Not authorized');

        const decryptedPins = decryptCodes(match.pins);
        delete match.pins;
        match.pins = decryptedPins;
        match.submission_count = match.submission_count || 0;
        return ok(res, match, 'Match fetched');
    } catch (error) {
        console.error('getMatchOwner error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

// Public respondent view — by slug. No rubric, no PINs, no rationale.
const getMatchPublic = async (req, res) => {
    try {
        const match = await Match.findOne({ slug: req.params.slug, access: true }).lean();
        if (!match) return fail(res, 404, 'Match not found');

        // Drafts/archived are not publicly viewable (only the creator can preview via owner route).
        if (match.status !== 'published') {
            const requester = uid(req);
            const owner = requester && match.created_by.toString() === requester.toString();
            if (!owner) return fail(res, 404, 'Match not found');
        }

        return ok(res, publicView(match, match.submission_count), 'Match fetched');
    } catch (error) {
        console.error('getMatchPublic error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

const verifyPin = async (req, res) => {
    try {
        const match = await Match.findOne({ slug: req.params.slug, access: true }).select('+pins');
        if (!match) return fail(res, 404, 'Match not found');
        if (!match.pin_enabled) return fail(res, 400, 'This match is not PIN protected');

        const matched = await matchAccessCode(req.body.pin, { pins: match.pins });
        if (!matched) return fail(res, 401, 'Invalid PIN');
        return ok(res, { valid: true }, 'PIN verified');
    } catch (error) {
        console.error('verifyPin error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

// ── submit + evaluate ────────────────────────────────────────────────────────────────
const submitMatch = async (req, res) => {
    try {
        const match = await Match.findOne({ slug: req.params.slug, access: true }).select('+pins');
        if (!match) return fail(res, 404, 'Match not found');

        const { accepting_responses, closed_reason } = computeAccepting(match, match.submission_count);
        if (!accepting_responses) {
            const msg = closed_reason === 'full' ? 'This match has reached its response limit'
                : closed_reason === 'ended' ? 'This match is closed'
                    : 'This match is not accepting responses';
            return fail(res, 403, msg);
        }

        if (match.pin_enabled) {
            if (!req.body.pin) return fail(res, 401, 'PIN required');
            if (!(await matchAccessCode(req.body.pin, { pins: match.pins }))) return fail(res, 401, 'Invalid PIN');
        }

        // Map submitted answers onto the stored questions (never trust client question text/type).
        const answerByQid = new Map((req.body.responses || []).map((r) => [String(r.question_id), r.answer]));
        const responses = [];
        for (const q of match.questions) {
            const raw = answerByQid.has(String(q._id)) ? answerByQid.get(String(q._id)) : null;
            const empty = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');
            if (q.is_required && empty) {
                return fail(res, 400, `Please answer: "${q.text}"`);
            }
            responses.push({ question_id: q._id, question_text: q.text, type: q.type, answer: empty ? null : raw });
        }

        const submission = new MatchSubmission({
            match_id: match._id,
            match_created_by: match.created_by,
            respondent_name: (match.response_settings?.collect_name !== false && req.body.respondent_name) ? req.body.respondent_name : '',
            respondent_user: uid(req) || null,
            responses,
            evaluation: { status: 'pending' },
        });
        await submission.save();
        await Match.updateOne({ _id: match._id }, { $inc: { submission_count: 1 } });

        // Fire-and-forget scoring — never blocks the respondent, never throws into this handler.
        evaluateSubmission(match.toObject(), submission).catch((e) =>
            console.error('[match] background evaluation failed:', e.message));

        return ok(res, { submitted: true }, 'Response submitted', 201);
    } catch (error) {
        console.error('submitMatch error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

// ── results (owner) ────────────────────────────────────────────────────────────────
const getSubmissions = async (req, res) => {
    try {
        const match = await Match.findOne({ _id: req.params.id, access: true }).lean();
        if (!match) return fail(res, 404, 'Match not found');
        if (!isOwner(match, req)) return fail(res, 403, 'Not authorized');

        const submissions = await MatchSubmission.find({ match_id: match._id })
            .sort({ 'evaluation.score': -1, createdAt: -1 })
            .lean();

        // Opening results marks them seen, so the "new responses" badge clears on the list.
        Match.updateOne({ _id: match._id }, { results_viewed_at: new Date() }).catch(() => {});

        const scored = submissions.filter((s) => s.evaluation?.status === 'evaluated' && typeof s.evaluation.score === 'number');
        const avgScore = scored.length
            ? Math.round((scored.reduce((a, s) => a + s.evaluation.score, 0) / scored.length) * 10) / 10
            : null;

        return ok(res, {
            match: {
                _id: match._id,
                title: match.title,
                needs_description: match.needs_description,
                evaluation_criteria: match.evaluation_criteria,
                questions: match.questions,
                submission_count: match.submission_count,
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
        const submission = await MatchSubmission.findById(req.params.submissionId);
        if (!submission) return fail(res, 404, 'Submission not found');
        if (submission.match_created_by.toString() !== (uid(req) || '').toString()) {
            return fail(res, 403, 'Not authorized');
        }
        const match = await Match.findById(submission.match_id).lean();
        if (!match) return fail(res, 404, 'Match not found');

        const evaluation = await evaluateSubmission(match, submission);
        return ok(res, { evaluation }, 'Submission re-evaluated');
    } catch (error) {
        console.error('reEvaluateSubmission error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

const deleteMatch = async (req, res) => {
    try {
        const match = await Match.findOne({ _id: req.params.id, access: true });
        if (!match) return fail(res, 404, 'Match not found');
        if (!isOwner(match, req)) return fail(res, 403, 'Only the creator can delete this match');

        match.access = false;
        await match.save();
        return ok(res, null, 'Match deleted');
    } catch (error) {
        console.error('deleteMatch error:', error);
        return fail(res, 500, 'Something went wrong');
    }
};

module.exports = {
    createMatch,
    editMatch,
    listMatches,
    getMatchOwner,
    getMatchPublic,
    verifyPin,
    submitMatch,
    getSubmissions,
    reEvaluateSubmission,
    deleteMatch,
};
