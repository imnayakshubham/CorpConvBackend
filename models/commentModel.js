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
    downvoted_by: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
    ],
    awards: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        type: { type: String }
    }],
    shares: { type: Number, default: 0 },
    reported_info: [
        {
            reporter: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
                required: true
            },
            targetUser: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
                required: true
            },
            reason: {
                type: String,
                required: true,
                trim: true
            },
            description: {
                type: String,
                trim: true
            },
            category: {
                type: String,
                enum: ["spam", "abuse", "harassment", "other"],
                default: "other"
            },
            createdAt: {
                type: Date,
                default: Date.now
            },
            status: {
                type: String,
                enum: ["pending", "reviewed", "resolved", "rejected"],
                default: "pending"
            }
        }
    ],
    is_edited: {
        type: Boolean,
        default: false
    },
    edit_history: [{
        comment: String,
        edited_at: { type: Date, default: Date.now }
    }],
    access: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('Comment', commentSchema);