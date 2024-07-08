const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema({
    answers: {
        type: String,
        required: true,
    },
    answered_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    answered_at: {
        type: Date,
        default: Date.now,
    },
    answer_id: {
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

module.exports = mongoose.model('Answer', answerSchema);