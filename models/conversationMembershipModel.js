const mongoose = require("mongoose");

// Per-user membership in a channel (a Chat with type: 'room'). DMs do NOT use this
// model — they keep their existing `users[]` array. `lastReadAt` powers cheap unread
// counts: count messages newer than this timestamp, avoiding per-message read arrays.
const conversationMembershipSchema = mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ['owner', 'moderator', 'member'], default: 'member' },
    // 'invited' = has a pending invite to a private channel; 'banned' = removed and blocked.
    status: { type: String, enum: ['active', 'invited', 'banned'], default: 'active' },
    lastReadAt: { type: Date, default: Date.now },
    joinedAt: { type: Date, default: Date.now },
    access: { type: Boolean, default: true },
  },
  { timestamps: true }
);

conversationMembershipSchema.index({ conversation: 1, user: 1 }, { unique: true });
conversationMembershipSchema.index({ user: 1, status: 1 });
conversationMembershipSchema.index({ conversation: 1, status: 1 });

const ConversationMembership = mongoose.model(
  "ConversationMembership",
  conversationMembershipSchema
);

module.exports = ConversationMembership;
