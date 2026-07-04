// controllers/hushAiConversationController.js — durable Hush AI conversation store.
//
// HTTP handlers load/save/clear a conversation for the signed-in user. `messages` are
// written server-side by the streaming chat's onEnd hook (saveMessages, below); the PUT
// handler only persists the client-only rewind/versioning state so the two writers never
// clobber each other. None of these are metered by the AI quota.

const HushAIConversation = require('../models/hushAIConversationModel');

const FEATURE_KEY = 'survey'; // these routes are mounted under the survey feature
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5MB guard (well under Mongo's 16MB doc cap)

const uid = (req) => req.user._id || req.user.id;

function tooLarge(obj) {
  try {
    return Buffer.byteLength(JSON.stringify(obj)) > MAX_PAYLOAD_BYTES;
  } catch (_) {
    return true; // unserializable → reject
  }
}

// GET /survey/ai/conversation/:id — return the stored conversation (or { empty:true }).
const loadConversation = async (req, res) => {
  try {
    const doc = await HushAIConversation.findOne(
      { user: uid(req), featureKey: FEATURE_KEY, resourceId: req.params.id },
    ).lean();
    if (!doc) return res.json({ empty: true });
    res.json({
      empty: false,
      messages: doc.messages || [],
      contextSummary: doc.contextSummary || '',
      summarizedThrough: doc.summarizedThrough || 0,
      turns: doc.turns || [],
      branches: doc.branches || {},
      pendingMutations: doc.pendingMutations || [],
      activeTurnIndex: doc.activeTurnIndex ?? null,
      clientVersion: doc.clientVersion || 0,
      updatedAt: doc.updatedAt,
    });
  } catch (err) {
    console.error('[hush-ai:conversation] load error:', err.message);
    res.status(500).json({ error: 'Could not load conversation.' });
  }
};

// PUT /survey/ai/conversation/:id — persist the transcript + client-only rewind/versioning
// state. Never writes contextSummary/summarizedThrough (owned by the server's onEnd sink),
// so the two writers touch disjoint fields and never clobber each other.
const saveConversation = async (req, res) => {
  try {
    const body = req.body || {};
    const state = {
      messages: Array.isArray(body.messages) ? body.messages : [],
      turns: Array.isArray(body.turns) ? body.turns : [],
      branches: body.branches && typeof body.branches === 'object' ? body.branches : {},
      pendingMutations: Array.isArray(body.pendingMutations) ? body.pendingMutations : [],
      activeTurnIndex: typeof body.activeTurnIndex === 'number' ? body.activeTurnIndex : null,
      clientVersion: typeof body.clientVersion === 'number' ? body.clientVersion : 0,
    };
    if (tooLarge(state)) return res.status(413).json({ error: 'Conversation state too large to save.' });

    await HushAIConversation.findOneAndUpdate(
      { user: uid(req), featureKey: FEATURE_KEY, resourceId: req.params.id },
      { $set: state, $setOnInsert: { contextSummary: '', summarizedThrough: 0 } },
      { upsert: true, new: true },
    );
    res.json({ ok: true, clientVersion: state.clientVersion });
  } catch (err) {
    console.error('[hush-ai:conversation] save error:', err.message);
    res.status(500).json({ error: 'Could not save conversation.' });
  }
};

// DELETE /survey/ai/conversation/:id — clear the whole conversation.
const clearConversation = async (req, res) => {
  try {
    await HushAIConversation.deleteOne({ user: uid(req), featureKey: FEATURE_KEY, resourceId: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('[hush-ai:conversation] clear error:', err.message);
    res.status(500).json({ error: 'Could not clear conversation.' });
  }
};

// Non-HTTP sink used by the streaming chat's onEnd hook. Writes ONLY the server-owned
// rolling summary (disjoint from the client's messages/aux). Best-effort — logs, never throws.
async function saveRollingSummary({ userId, featureKey, resourceId, contextSummary, summarizedThrough }) {
  try {
    if (!userId || !resourceId || typeof contextSummary !== 'string') return;
    const set = { contextSummary };
    if (typeof summarizedThrough === 'number') set.summarizedThrough = summarizedThrough;
    await HushAIConversation.findOneAndUpdate(
      { user: userId, featureKey: featureKey || FEATURE_KEY, resourceId },
      { $set: set, $setOnInsert: { messages: [] } },
      { upsert: true },
    );
  } catch (err) {
    console.error('[hush-ai:conversation] saveRollingSummary error:', err.message);
  }
}

// Read just the stored rolling summary for a conversation (used by the chat context layer).
async function loadContextSummary({ userId, featureKey, resourceId }) {
  try {
    if (!userId || !resourceId) return { contextSummary: '', summarizedThrough: 0 };
    const doc = await HushAIConversation.findOne(
      { user: userId, featureKey: featureKey || FEATURE_KEY, resourceId },
      { contextSummary: 1, summarizedThrough: 1 },
    ).lean();
    return { contextSummary: doc?.contextSummary || '', summarizedThrough: doc?.summarizedThrough || 0 };
  } catch (_) {
    return { contextSummary: '', summarizedThrough: 0 };
  }
}

module.exports = {
  loadConversation,
  saveConversation,
  clearConversation,
  saveRollingSummary,
  loadContextSummary,
};
