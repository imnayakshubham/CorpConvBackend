const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
    comment: {
        type: String,
        required: true,
    },
    commented_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    commented_at: {
        type: Date,
        default: Date.now,
    },
    post_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Post',
        required: true,
    },
    parent_comment_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Comment',
    },
    nested_comments: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Comment',
        },
    ],
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

module.exports = mongoose.model('Comment', commentSchema);