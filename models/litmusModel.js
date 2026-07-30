const mongoose = require('mongoose');
const generateSlug = require('../utils/generateSlug');
const { baseQuestionFields, QUESTION_TYPES } = require('./shared/questionSchema');

// A Litmus is an AI-built, PIN-gated evaluation: the creator describes their needs +
// criteria, Hush AI generates a set of interrelated questions, and every submission is scored
// 0-10 against the criteria. The question shape reuses the shared base (models/shared/
// questionSchema.js); everything else is Litmus-specific.

// Shared base fields + the Litmus-only `rationale` (why the question ties to the needs/criteria —
// powers the "interrelated" guarantee, shown to the creator, never to the respondent).
const questionSchema = new mongoose.Schema({
    ...baseQuestionFields(),
    rationale: { type: String, default: '', maxlength: 400 },
}, { _id: true });

const litmusSchema = new mongoose.Schema({
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

litmusSchema.pre('save', function (next) {
    if (!this.slug) {
        this.slug = generateSlug(this.title);
    }
    next();
});

litmusSchema.index({ created_by: 1, createdAt: -1 });

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
    litmus_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Litmus', required: true },
    // Denormalized so the creator's results query never needs a join back to the litmus.
    litmus_created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Respondent-supplied, optional (feature is public + anonymous-first).
    respondent_name: { type: String, default: '', maxlength: 120 },
    // Populated only if the respondent happened to be logged in (optionalAuth).
    respondent_user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    responses: { type: [responseSchema], default: [] },
    evaluation: { type: evaluationSchema, default: () => ({}) },
}, { timestamps: true });

submissionSchema.index({ litmus_id: 1, createdAt: -1 });
submissionSchema.index({ litmus_id: 1, 'evaluation.score': -1 });

// Explicit collection names so the model maps to the intended collections (mongoose would
// otherwise pluralize 'Litmus' → 'litmuses'). See the migration script that renames the old
// 'matches' / 'matchsubmissions' collections to these.
const Litmus = mongoose.model('Litmus', litmusSchema, 'litmus');
const LitmusSubmission = mongoose.model('LitmusSubmission', submissionSchema, 'litmussubmissions');

module.exports = { Litmus, LitmusSubmission, QUESTION_TYPES };
