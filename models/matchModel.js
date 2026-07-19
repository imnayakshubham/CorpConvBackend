const mongoose = require('mongoose');
const generateSlug = require('../utils/generateSlug');

// An Match is an AI-built, PIN-gated evaluation: the creator describes their needs +
// criteria, Hush AI generates a set of interrelated questions, and every submission is scored
// 0-10 against the criteria. Independent of the Survey feature — nothing here is shared with it.

const QUESTION_TYPES = ['text', 'single_choice', 'rating'];

const ratingScaleSchema = new mongoose.Schema({
    min: { type: Number, default: 1 },
    max: { type: Number, default: 5 },
    min_label: { type: String, default: '', maxlength: 60 },
    max_label: { type: String, default: '', maxlength: 60 },
}, { _id: false });

const questionSchema = new mongoose.Schema({
    text: { type: String, required: true, maxlength: 500 },
    type: { type: String, enum: QUESTION_TYPES, default: 'text' },
    // Only meaningful for single_choice.
    options: { type: [String], default: undefined },
    // Only meaningful for rating.
    rating_scale: { type: ratingScaleSchema, default: undefined },
    // Why this question ties back to the needs/criteria — powers the "interrelated" guarantee
    // and is shown to the creator (never to the respondent).
    rationale: { type: String, default: '', maxlength: 400 },
    is_required: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
}, { _id: true });

const matchSchema = new mongoose.Schema({
    created_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    title: { type: String, required: true, minlength: 3, maxlength: 120 },
    // What the creator is evaluating for — the "needs". Fed to generation + scoring, never sent
    // to respondents.
    needs_description: { type: String, required: true, maxlength: 4000 },
    // The rubric lines used to generate questions and to score each submission.
    evaluation_criteria: { type: [String], default: [] },
    max_questions: { type: Number, default: 8, min: 2, max: 20 },
    questions: { type: [questionSchema], default: [] },

    status: {
        type: String,
        enum: ['draft', 'published', 'archived'],
        default: 'draft',
    },
    slug: { type: String, unique: true },

    // Access: link + PIN only (no visibility tiers). `pins` are AES-encrypted so the creator can
    // view/manage them; stripped from every non-creator response.
    pin_enabled: { type: Boolean, default: false },
    pins: { type: [String], default: [], select: false },

    response_settings: {
        max_responses: { type: Number, default: null },
        collect_name: { type: Boolean, default: true },
        closes_at: { type: Date, default: null },
    },

    submission_count: { type: Number, default: 0 },
    // When the creator last opened the results — drives the "new responses" badge on the list.
    results_viewed_at: { type: Date, default: null },
    // Soft-delete flag (mirrors Poll/Survey `access`).
    access: { type: Boolean, default: true },
}, { timestamps: true });

matchSchema.pre('save', function (next) {
    if (!this.slug) {
        this.slug = generateSlug(this.title);
    }
    next();
});

matchSchema.index({ created_by: 1, createdAt: -1 });

const responseSchema = new mongoose.Schema({
    question_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    question_text: { type: String, default: '' },
    type: { type: String, enum: QUESTION_TYPES, default: 'text' },
    // String | Number depending on question type.
    answer: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false });

const criterionScoreSchema = new mongoose.Schema({
    criterion: { type: String, default: '' },
    score: { type: Number, default: null },        // 0-10 for this criterion
    note: { type: String, default: '' },           // one short clause of justification
}, { _id: false });

const evaluationSchema = new mongoose.Schema({
    score: { type: Number, default: null },       // 0-10 overall
    summary: { type: String, default: '' },        // short "why"
    criteria_scores: { type: [criterionScoreSchema], default: [] },  // per-criterion breakdown
    status: {
        type: String,
        enum: ['pending', 'evaluated', 'failed'],
        default: 'pending',
    },
    model: { type: String, default: '' },
    evaluated_at: { type: Date, default: null },
}, { _id: false });

const submissionSchema = new mongoose.Schema({
    match_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', required: true },
    // Denormalized so the creator's results query never needs a join back to the match.
    match_created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Respondent-supplied, optional (feature is public + anonymous-first).
    respondent_name: { type: String, default: '', maxlength: 120 },
    // Populated only if the respondent happened to be logged in (optionalAuth).
    respondent_user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    responses: { type: [responseSchema], default: [] },
    evaluation: { type: evaluationSchema, default: () => ({}) },
}, { timestamps: true });

submissionSchema.index({ match_id: 1, createdAt: -1 });
submissionSchema.index({ match_id: 1, 'evaluation.score': -1 });

const Match = mongoose.model('Match', matchSchema);
const MatchSubmission = mongoose.model('MatchSubmission', submissionSchema);

module.exports = { Match, MatchSubmission, QUESTION_TYPES };
