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
}, { timestamps: true });


const surveyFormFieldSchema = new mongoose.Schema({
    label: { type: String, required: true },
    placeholder: { type: String, required: false },
    input_type: { type: String, required: true },
    user_select_options: [
        {
            label: { type: String, required: true },
            value: { type: String, required: true }
        }
    ]
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
    reported_by: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
    ],
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
    tags: [{ type: String, default: [] }],
    access: { type: Boolean, default: true }
}, { timestamps: true });

surveySchema.pre('save', function (next) {
    try {
        console.log("Pre-save hook triggered");
        if (this.survey_title) {
            this.survey_title = this.survey_title.trim();
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
