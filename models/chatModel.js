const mongoose = require("mongoose");

const chatModel = mongoose.Schema(
  {
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
    status: { type: String, enum: ['accepted', 'pending', 'rejected'], default: 'accepted' },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    unreadCounts: { type: Map, of: Number, default: {} },
  },
  { timestamps: true }
);

const Chat = mongoose.model("Chat", chatModel);

module.exports = Chat;
