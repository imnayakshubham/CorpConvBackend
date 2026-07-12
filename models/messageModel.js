const mongoose = require("mongoose");

const messageSchema = mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    content: { type: String, trim: true, default: '' },
    chat: { type: mongoose.Schema.Types.ObjectId, ref: "Chat" },
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    // Threads: a reply belonging under a root message sets `threadRoot`; the root
    // tracks `replyCount`/`lastReplyAt` for its "N replies" affordance. Distinct from
    // `replyTo` (inline quote-reply). The main message list filters `threadRoot: null`,
    // which also matches every existing DM message where the field is absent.
    threadRoot: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    replyCount: { type: Number, default: 0 },
    lastReplyAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    isEdited: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
    reactions: [{
      emoji: { type: String, required: true },
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    }],
    links: [{
      url: { type: String },
      title: { type: String, default: '' },
      description: { type: String, default: '' },
      image: { type: String, default: null },
      favicon: { type: String, default: null },
      author: { type: String, default: '' },
    }],
  },
  { timestamps: true }
);

// Supports the main message cursor list and the cheap channel unread count
// (messages in a conversation newer than a member's lastReadAt).
messageSchema.index({ chat: 1, createdAt: -1 });
// Supports fetching a thread's replies chronologically.
messageSchema.index({ threadRoot: 1, createdAt: 1 });

const Message = mongoose.model("Message", messageSchema);
module.exports = Message;
