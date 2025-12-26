const mongoose = require("mongoose");

const postModel = mongoose.Schema({
    category: { type: String, trim: true, required: true },
    content: { type: String, trim: true, required: true },
    upvoted_by: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    downvoted_by: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    posted_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    comments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Comment" }],
    awards: [{ type: String }],
    shares: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model("Post", postModel);