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
    awards: [{ type: String }],
    shares: { type: Number, default: 0 },
    reported_info: [
        {
            reporter: {
                // who reported
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
                required: true
            },
            targetUser: {
                // who is being reported (if applicable)
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
                required: true
            },
            reason: {
                // reason for reporting
                type: String,
                required: true,
                trim: true
            },
            description: {
                // optional detailed explanation
                type: String,
                trim: true
            },
            category: {
                // type/category of report (spam, abuse, etc.)
                type: String,
                enum: ["spam", "abuse", "harassment", "other"],
                default: "other"
            },
            createdAt: {
                // timestamp
                type: Date,
                default: Date.now
            },
            status: {
                // for review workflow
                type: String,
                enum: ["pending", "reviewed", "resolved", "rejected"],
                default: "pending"
            }
        }
    ],
    access: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('Comment', commentSchema);