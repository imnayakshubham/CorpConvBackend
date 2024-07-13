const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema({
    answer: {
        type: String,
        required: true,
    },
    answered_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    answered_at: {
        type: Date,
        default: Date.now(),
    },
    question_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Question',
        required: true,
    },
    upvoted_by: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
    ],
    access: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('AnswerToQuestion', answerSchema);