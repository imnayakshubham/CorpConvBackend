const mongoose = require("mongoose");
const generateSlug = require("../utils/generateSlug");

const chatModel = mongoose.Schema(
  {
    // `type` distinguishes the conversation kinds. Defaults to 'dm' so every
    // pre-existing chat doc reads back as a valid conversation with no migration.
    // Only 'room' (a Slack-style channel) gets the channel behavior; 'group' is a
    // multi-person DM, 'self' is Saved Messages. Channel-only fields below stay
    // undefined on non-room docs.
    type: { type: String, enum: ['dm', 'group', 'room', 'self'], default: 'dm' },
    chatName: { type: String, trim: true },
    isGroupChat: { type: Boolean, default: false },
    users: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    latestMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    unreadMessage: [{
      messageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Message",
      },
      readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    }],

    groupAdmin: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: { type: String, enum: ['accepted', 'pending', 'rejected', 'archived'], default: 'accepted' },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    unreadCounts: { type: Map, of: Number, default: {} },
    blockedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    access: { type: Boolean, default: true },

    // --- Channel fields (type: 'room'). Unused on DMs. ---
    name: { type: String, trim: true },
    description: { type: String, trim: true, default: '' },
    // sparse so the many DM docs without a slug don't collide on the unique index.
    slug: { type: String, unique: true, sparse: true },
    roomType: { type: String, enum: ['public', 'private', 'workspace_townhall'] },
    // Mirrors the poll access ladder (pollModel) so the same gating logic transfers.
    visibility: { type: String, enum: ['public', 'logged_in', 'workspace'], default: 'public' },
    workspace_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    // `pins` holds AES-encrypted creator-visible access codes (see utils/pinCrypto).
    pin_enabled: { type: Boolean, default: false },
    pins: { type: [String], default: [], select: false },
    moderators: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    bannedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

// Channels get a URL-safe slug from their name; DMs never do.
chatModel.pre('save', function (next) {
  if (this.type === 'room' && !this.slug && this.name) {
    this.slug = generateSlug(this.name);
  }
  next();
});

chatModel.index({ type: 1, roomType: 1, visibility: 1 });

const Chat = mongoose.model("Chat", chatModel);

module.exports = Chat;
