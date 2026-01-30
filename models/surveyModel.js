const mongoose = require('mongoose');

// Structured response for each field in a submission
const submissionResponseSchema = new mongoose.Schema({
    field_id: { type: String, required: true },
    label: { type: String },
    input_type: { type: String },
    value: { type: mongoose.Schema.Types.Mixed },
    // Quiz-specific fields
    is_correct: { type: Boolean },
    score_earned: { type: Number, default: 0 }
}, { _id: false });

const submissionSchema = new mongoose.Schema({
    survey_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Survey',
        required: true
    },
    survey_answered_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    survey_created_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    // Structured responses array (new format)
    responses: [submissionResponseSchema],
    // Legacy submissions array for backwards compatibility
    submissions: [{
        type: mongoose.Schema.Types.Mixed,
        required: false
    }],
    // Quiz results
    total_score: { type: Number, default: 0 },
    max_possible_score: { type: Number, default: 0 },
    percentage_score: { type: Number, default: 0 },
    // Partial save support for multi-step forms
    is_partial: { type: Boolean, default: false },
    current_page: { type: Number, default: 0 },
    access: { type: Boolean, default: true }
}, { timestamps: true });

// Conditional logic rule schema
const conditionalRuleSchema = new mongoose.Schema({
    field_id: { type: String, required: true }, // The field to check
    operator: {
        type: String,
        enum: ['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 'is_empty', 'is_not_empty'],
        required: true
    },
    value: { type: mongoose.Schema.Types.Mixed } // The value to compare against
}, { _id: false });

const conditionalLogicSchema = new mongoose.Schema({
    enabled: { type: Boolean, default: false },
    action: { type: String, enum: ['show', 'hide'], default: 'show' },
    logic_type: { type: String, enum: ['all', 'any'], default: 'all' }, // all = AND, any = OR
    rules: [conditionalRuleSchema]
}, { _id: false });

// Option schema with quiz support
const optionSchema = new mongoose.Schema({
    label: { type: String, required: true },
    value: { type: String, required: true },
    // Quiz mode fields
    is_correct: { type: Boolean, default: false },
    score: { type: Number, default: 0 }
}, { _id: false });

const surveyFormFieldSchema = new mongoose.Schema({
    // Unique identifier for each field (optional - _id is the canonical identifier)
    // field_id is kept for backwards compatibility with existing surveys
    field_id: { type: String, required: false },
    label: { type: String, required: true },
    placeholder: { type: String, required: false },
    description: { type: String, required: false },
    input_type: { type: String, required: true },
    // Multi-step form support
    page_index: { type: Number, default: 0 },
    // Options for select/radio/checkbox with quiz support
    user_select_options: [optionSchema],
    is_required: { type: Boolean, default: false },
    // Validation rules
    min_length: { type: Number },
    max_length: { type: Number },
    regex_pattern: { type: String },
    error_message: { type: String },
    // Email-specific
    auto_complete_domain: { type: String },
    allowed_domains: { type: String },
    // Conditional logic
    conditional_logic: conditionalLogicSchema,
    // Quiz mode - score for this field (for non-option fields like text matching)
    quiz_score: { type: Number, default: 0 },
    quiz_correct_answer: { type: String },
    access: { type: Boolean, default: true },
    is_active: { type: Boolean, default: true },
}, { timestamps: true });

// Page schema for multi-step forms
const pageSchema = new mongoose.Schema({
    page_id: { type: String, required: true },
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    order: { type: Number, default: 0 }
}, { _id: false });

// Quiz settings schema
const quizSettingsSchema = new mongoose.Schema({
    enabled: { type: Boolean, default: false },
    show_correct_answers: { type: Boolean, default: true }, // Show correct answers after submission
    show_score_immediately: { type: Boolean, default: true },
    passing_score: { type: Number, default: 0 }, // Minimum percentage to pass
    time_limit: { type: Number }, // Time limit in minutes (optional)
    randomize_questions: { type: Boolean, default: false },
    randomize_options: { type: Boolean, default: false }
}, { _id: false });

// Sharing settings schema
const sharingSettingsSchema = new mongoose.Schema({
    is_public: { type: Boolean, default: true },
    password_protected: { type: Boolean, default: false },
    password: { type: String }, // Hashed password
    allow_anonymous: { type: Boolean, default: false },
    embed_enabled: { type: Boolean, default: true },
    custom_slug: { type: String }, // Custom URL slug
    redirect_url: { type: String }, // URL to redirect after submission
    close_message: { type: String, default: 'Thank you for your submission!' }
}, { _id: false });

// Response settings schema
const responseSettingsSchema = new mongoose.Schema({
    max_responses: { type: Number }, // Limit total responses (null = unlimited)
    one_response_per_user: { type: Boolean, default: false },
    allow_edit_response: { type: Boolean, default: false },
    start_date: { type: Date },
    end_date: { type: Date },
    show_progress_bar: { type: Boolean, default: true }
}, { _id: false });

// Theme settings schema
const themeSettingsSchema = new mongoose.Schema({
    primary_color: { type: String, default: '#000000' },
    background_color: { type: String, default: '#ffffff' },
    font_family: { type: String, default: 'Inter' },
    logo_url: { type: String },
    cover_image_url: { type: String },
    button_style: { type: String, enum: ['rounded', 'square', 'pill'], default: 'rounded' }
}, { _id: false });

// Notification settings schema
const notificationSettingsSchema = new mongoose.Schema({
    email_on_submission: { type: Boolean, default: false },
    notification_emails: [{ type: String }], // Array of emails to notify
    webhook_url: { type: String },
    webhook_enabled: { type: Boolean, default: false }
}, { _id: false });

// Form settings schema (navigation buttons, success message, etc.)
const formSettingsSchema = new mongoose.Schema({
    show_back_button: { type: Boolean, default: true },
    back_button_text: { type: String, default: 'Previous' },
    next_button_text: { type: String, default: 'Next' },
    submit_button_text: { type: String, default: 'Submit' },
    success_message: { type: String, default: 'Thank you for your submission!' },
    redirect_url: { type: String },
    public_title: { type: String },
    form_description: { type: String },
    max_submissions: { type: Number },
    submission_deadline: { type: Date },
    one_submission_per_user: { type: Boolean, default: false },
    require_login: { type: Boolean, default: false },
    captcha_enabled: { type: Boolean, default: false },
}, { _id: false });

const surveySchema = new mongoose.Schema({
    survey_title: {
        type: String,
        required: true,
        trim: true,
        minlength: 3,
        maxlength: 100
    },
    view_count: {
        type: Number,
        default: 0,
    },
    survey_description: {
        type: String,
        default: null,
        trim: true
    },
    submissions: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Submission',
            required: true
        }
    ],
    survey_form: [surveyFormFieldSchema],
    // Multi-step form pages
    pages: {
        type: [pageSchema],
        default: [{ page_id: 'page_default', title: 'Page 1', description: '', order: 0 }]
    },

    is_multi_step: {
        type: Boolean,
        default: false
    },
    // Quiz mode settings
    quiz_settings: {
        type: quizSettingsSchema,
        default: () => ({})
    },
    // Sharing settings
    sharing: {
        type: sharingSettingsSchema,
        default: () => ({})
    },
    // Response settings
    response_settings: {
        type: responseSettingsSchema,
        default: () => ({})
    },
    // Theme customization
    theme: {
        type: themeSettingsSchema,
        default: () => ({})
    },
    // Notification settings
    notifications: {
        type: notificationSettingsSchema,
        default: () => ({})
    },
    // Form settings (navigation buttons, success message, etc.)
    form_settings: {
        type: formSettingsSchema,
        default: () => ({})
    },
    reported_by: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
    ],
    slug: {
        type: String,
        default: null,
        trim: true
    },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
    tags: [{ type: String, default: [] }],
    access: { type: Boolean, default: true }
}, { timestamps: true });

// Indexes for efficient querying
surveySchema.index({ survey_title: 'text', survey_description: 'text', tags: 'text' }, {
    weights: { survey_title: 10, tags: 5, survey_description: 1 },
    name: 'survey_text_search'
});
surveySchema.index({ status: 1, createdAt: -1 });
surveySchema.index({ created_by: 1, createdAt: -1 });
surveySchema.index({ tags: 1 });

surveySchema.pre('save', function (next) {
    try {
        console.log("Pre-save hook triggered");
        if (this.survey_title) {
            this.survey_title = this.survey_title.trim();
            // addd below slug creation like notion
            this.slug = this.survey_title.toLowerCase().replace(/\s+/g, '-')
        }


        if (this.survey_description) {
            this.survey_description = this.survey_description.trim();
        }
        next();
    } catch (error) {
        console.error("Error in pre-save hook:", error);
        next(error);
    }
});


module.exports = {
    Survey: mongoose.model('Survey', surveySchema),
    Submission: mongoose.model('Submission', submissionSchema)
};
