const mongoose = require('mongoose');
const { QUESTION_TYPES } = require('../../shared/questionTypes');

// Shared Mongoose building blocks for a question/field, reused across features (Litmus, and
// available for Survey to adopt). Each feature composes its own schema from the base fields plus
// its own extras, so the common shape lives in exactly one place.

const ratingScaleSchema = new mongoose.Schema({
    min: { type: Number, default: 1 },
    max: { type: Number, default: 5 },
    min_label: { type: String, default: '', maxlength: 60 },
    max_label: { type: String, default: '', maxlength: 60 },
}, { _id: false });

// The fields every question shares. Spread into a feature schema, adding feature-specific fields:
//   new mongoose.Schema({ ...baseQuestionFields(), rationale: {...} }, { _id: true })
function baseQuestionFields() {
    return {
        text: { type: String, required: true, maxlength: 500 },
        type: { type: String, enum: QUESTION_TYPES, default: 'text' },
        // Only meaningful for single_choice.
        options: { type: [String], default: undefined },
        // Only meaningful for rating.
        rating_scale: { type: ratingScaleSchema, default: undefined },
        is_required: { type: Boolean, default: true },
        order: { type: Number, default: 0 },
    };
}

module.exports = { ratingScaleSchema, baseQuestionFields, QUESTION_TYPES };
