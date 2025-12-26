const mongoose = require("mongoose");

const postModel = mongoose.Schema({
    category: { type: String, trim: true, required: true },
    content: { type: String, trim: true, required: true },
    upvoted_by: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    downvoted_by: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    posted_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    comments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Comment" }],
    awards: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        type: { type: String }
    }],
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
    shares: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model("Post", postModel);