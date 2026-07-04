// models/hushAIConversationModel.js — durable, cross-device Hush AI conversations.
//
// Generic across features (keyed by featureKey = plugin.key), so any HushAIPlugin reuses
// this one store. `messages` is the authoritative UIMessage[] transcript (persisted by the
// official onEnd hook at stream end). The rest is client-only rewind/versioning state that
// the model never needs but we persist so history survives reloads and other devices.

const mongoose = require('mongoose');

const hushAIConversationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    featureKey: { type: String, required: true }, // plugin.key, e.g. 'survey'
    resourceId: { type: String, required: true }, // e.g. survey id

    // Authoritative visible transcript (UIMessage[]). Saved server-side via onEnd.
    messages: { type: mongoose.Schema.Types.Mixed, default: [] },

    // Server-managed rolling summary of older turns (condensed context, never shown).
    contextSummary: { type: String, default: '' },
    summarizedThrough: { type: Number, default: 0 }, // # of leading messages folded into the summary

    // Client-only rewind / checkpoint / message-versioning state.
    turns: { type: mongoose.Schema.Types.Mixed, default: [] },
    branches: { type: mongoose.Schema.Types.Mixed, default: {} },
    pendingMutations: { type: mongoose.Schema.Types.Mixed, default: [] },
    activeTurnIndex: { type: Number, default: null },

    // Monotonic version so the newest writer wins on reconcile.
    clientVersion: { type: Number, default: 0 },
  },
  { timestamps: true, minimize: false } // minimize:false keeps empty {}/[] instead of dropping them
);

// One conversation per (user, feature, resource).
hushAIConversationSchema.index({ user: 1, featureKey: 1, resourceId: 1 }, { unique: true });

module.exports = mongoose.model('HushAIConversation', hushAIConversationSchema);
