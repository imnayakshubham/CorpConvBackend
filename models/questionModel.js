

// Create Question Schema with Mongoose and Bookmark and Like


const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
    question_posted_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    question: {
        type: String,
        required: true,
        default: "What do you think about ...?"
    },
    answers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AnswerToQuestion',
    }],
    access: {
        type: Boolean,
        default: true
    },
    question_posted_at: {
        type: Date,
        default: Date.now(),
    },
    bookmarked_by: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
    ],
    liked_by: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
    ],
    status: {
        type: String,
        enum: ['draft', 'open', 'closed'],
        default: 'open',
    },
    visibility: {
        type: String,
        enum: ['public', 'workspace'],
        default: 'public',
    },
    workspace_id: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },
    openAt: {
        type: Date,
        default: null,
    },
    closeAt: {
        type: Date,
        default: null,
    },
}, { timestamps: true });

module.exports = mongoose.model('Question', questionSchema);