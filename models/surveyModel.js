const mongoose = require('mongoose');

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
    submissions: [{
        type: mongoose.Schema.Types.Mixed,
        required: true
    }],
    access: { type: Boolean, default: true }
}, { timestamps: true });

// New schemas for enhanced features
const conditionalLogicSchema = new mongoose.Schema({
    field_id: {
        type: String,
        required: true
    },
    condition: {
        field_id: {
            type: String,
            required: true
        },
        operator: {
            type: String,
            enum: ['equals', 'contains', 'greater_than', 'less_than', 'not_equals'],
            required: true
        },
        value: mongoose.Schema.Types.Mixed
    },
    action: {
        type: String,
        enum: ['show', 'hide', 'require', 'disable'],
        required: true
    }
});

const fieldValidationSchema = new mongoose.Schema({
    min_length: Number,
    max_length: Number,
    pattern: String,
    custom_message: String,
    required: {
        type: Boolean,
        default: false
    }
});

const formSettingsSchema = new mongoose.Schema({
    allow_multiple_submissions: {
        type: Boolean,
        default: true
    },
    require_authentication: {
        type: Boolean,
        default: false
    },
    submit_button_text: {
        type: String,
        default: 'Submit'
    },
    success_message: {
        type: String,
        default: 'Thank you for your submission!'
    },
    redirect_url: String,
    collect_email: {
        type: Boolean,
        default: false
    },
    is_public: {
        type: Boolean,
        default: true
    }
});

const formThemeSchema = new mongoose.Schema({
    primary_color: {
        type: String,
        default: '#3b82f6'
    },
    background_color: {
        type: String,
        default: '#ffffff'
    },
    font_family: {
        type: String,
        default: 'Inter'
    },
    border_radius: {
        type: String,
        default: '8px'
    },
    custom_css: String
});

const formAnalyticsSchema = new mongoose.Schema({
    total_views: {
        type: Number,
        default: 0
    },
    total_submissions: {
        type: Number,
        default: 0
    },
    conversion_rate: {
        type: Number,
        default: 0
    },
    last_submission_at: Date
});

const surveyFormFieldSchema = new mongoose.Schema({
    label: { type: String, required: true },
    placeholder: { type: String, required: false },
    input_type: {
        type: String, required: function () {
            // Only required if 'type' is not provided
            return !this.type;
        }
    },
    user_select_options: [
        {
            label: { type: String, required: true },
            value: { type: String, required: true }
        }
    ],
    is_required: { type: Boolean, default: false },

    type: {
        type: String,
        enum: ['text', 'email', 'number', 'select', 'checkbox', 'radio', 'textarea', 'file', 'date', 'phone', 'url'],
        // Map from input_type if type is not provided
        default: function () {
            if (this.input_type) {
                // Map old input_type to new type enum
                const typeMap = {
                    'text': 'text',
                    'email': 'email',
                    'number': 'number',
                    'select': 'select',
                    'checkbox': 'checkbox',
                    'radio': 'radio',
                    'textarea': 'textarea',
                    'file': 'file',
                    'date': 'date',
                    'tel': 'phone',
                    'phone': 'phone',
                    'url': 'url'
                };
                return typeMap[this.input_type] || 'text';
            }
            return undefined;
        }
    },
    position: {
        x: {
            type: Number,
            default: 0
        },
        y: {
            type: Number,
            default: 0
        }
    },
    user_select_options: [String], // Alternative to user_select_options
    validation: fieldValidationSchema,
    conditional_logic: {
        show_if: [conditionalLogicSchema]
    },
    styling: {
        width: {
            type: String,
            default: 'full'
        },
        className: String
    }
});


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
    reported_by: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
    ],
    created_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    status: {
        type: String,
        enum: ['draft', 'published', 'archived'],
        default: 'draft'
    },
    tags: [{
        type: String,
        default: []
    }],
    access: {
        type: Boolean,
        default: true
    },

    // New fields from Form model
    logic: [conditionalLogicSchema],
    settings: {
        type: formSettingsSchema,
        default: () => ({})
    },
    theme: {
        type: formThemeSchema,
        default: () => ({})
    },
    analytics: {
        type: formAnalyticsSchema,
        default: () => ({})
    },
    slug: {
        type: String,
        unique: true,
        sparse: true
    },
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, { timestamps: true });

// Original pre-save hook
surveySchema.pre('save', function (next) {
    try {
        console.log("Pre-save hook triggered");
        if (this.survey_title) {
            this.survey_title = this.survey_title.trim();
        }
        if (this.survey_description) {
            this.survey_description = this.survey_description.trim();
        }

        // Generate slug if not present (from new model)
        if (!this.slug && this.survey_title) {
            const baseSlug = this.survey_title
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '');

            this.slug = `${baseSlug}-${Date.now()}`;
        }

        // Update conversion rate (from new model)
        if (this.analytics && this.analytics.total_views > 0) {
            this.analytics.conversion_rate = (this.analytics.total_submissions / this.analytics.total_views) * 100;
        }

        // Sync view_count with analytics.total_views
        if (this.analytics && this.view_count !== undefined) {
            this.analytics.total_views = this.view_count;
        }

        // Map user_select_options to options for new fields
        if (this.survey_form && this.survey_form.length > 0) {
            this.survey_form.forEach(field => {
                // If user_select_options exists but options doesn't, map them
                if (field.user_select_options && field.user_select_options.length > 0 && !field.options) {
                    field.options = field.user_select_options.map(opt => opt.value);
                }

                // Sync is_required with validation.required
                if (field.is_required !== undefined && !field.validation) {
                    field.validation = { required: field.is_required };
                }
            });
        }

        next();
    } catch (error) {
        console.error("Error in pre-save hook:", error);
        next(error);
    }
});

// New indexes from Form model
surveySchema.index({ status: 1, createdAt: -1 });
surveySchema.index({ slug: 1 });
surveySchema.index({ user_id: 1 });
surveySchema.index({ created_by: 1 }); // Keep existing index

// Virtual to maintain compatibility between user_id and created_by
surveySchema.virtual('createdBy').get(function () {
    return this.created_by || this.user_id;
});

// Method to convert old field format to new format
surveySchema.methods.migrateFieldFormat = function () {
    if (this.survey_form && this.survey_form.length > 0) {
        this.survey_form = this.survey_form.map(field => {
            // Map old format to new format
            if (!field.type && field.input_type) {
                field.type = field.input_type;
            }

            if (!field.id) {
                field.id = `field_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            }

            if (field.user_select_options && !field.options) {
                field.options = field.user_select_options.map(opt => opt.value);
            }

            if (field.is_required !== undefined && !field.validation) {
                field.validation = { required: field.is_required };
            }

            return field;
        });
    }
    return this;
};

// Method to get analytics in old format (for backward compatibility)
surveySchema.methods.getViewCount = function () {
    if (this.analytics && this.analytics.total_views !== undefined) {
        return this.analytics.total_views;
    }
    return this.view_count || 0;
};

// Method to update view count (works with both old and new structure)
surveySchema.methods.incrementViewCount = function () {
    this.view_count = (this.view_count || 0) + 1;

    if (!this.analytics) {
        this.analytics = {};
    }
    this.analytics.total_views = (this.analytics.total_views || 0) + 1;

    return this.save();
};

module.exports = {
    Survey: mongoose.model('Survey', surveySchema),
    Submission: mongoose.model('Submission', submissionSchema)
};