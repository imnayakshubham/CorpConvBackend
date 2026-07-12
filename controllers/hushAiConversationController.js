// controllers/hushAiConversationController.js — durable Hush AI conversation store.
//
// The CLIENT is the sole writer of the transcript (`messages`) and of the rewind/branch state.
// The server writes only the rolling summary (`contextSummary` / `summarizedThrough`) from the
// streaming chat's onEnd hook. The two writers touch disjoint fields, so neither needs a lock
// against the other.
//
// Two clients editing the same conversation DO need a lock against each other. `clientVersion`
// is a server-authoritative optimistic-concurrency token: a save must declare the version it
// read, and the update only lands if that is still the current version. A stale writer gets a
// 409 carrying the current state rather than silently overwriting newer work.
//
// None of these routes are metered by the AI quota — persistence must never burn the budget.

const HushAIConversation = require('../models/hushAIConversationModel');
const { CONVERSATION_MAX_BODY_BYTES } = require('../config/payloadLimits');

const uid = (req) => req.user._id || req.user.id;

function tooLarge(obj) {
  try {
    return Buffer.byteLength(JSON.stringify(obj)) > CONVERSATION_MAX_BODY_BYTES;
  } catch (_) {
    return true; // unserializable → reject
  }
}

// The shape both GET and a 409 hand back, so the client can restore from either without a
// second round-trip.
const toWire = (doc) => ({
  empty: false,
  messages: doc.messages || [],
  contextSummary: doc.contextSummary || '',
  summarizedThrough: doc.summarizedThrough || 0,
  turns: doc.turns || [],
  branches: doc.branches || {},
  pendingMutations: doc.pendingMutations || [],
  activeTurnIndex: doc.activeTurnIndex ?? null,
  version: doc.clientVersion || 0,
  updatedAt: doc.updatedAt,
});

/**
 * Build the conversation handlers for one feature. `featureKey` namespaces every record, so a
 * second plugin (polls, posts, …) mounts its own routes without colliding with the survey's.
 */
function createConversationHandlers(featureKey) {
  const keyFor = (req) => ({ user: uid(req), featureKey, resourceId: req.params.id });

  // GET /:feature/ai/conversation/:id
  const loadConversation = async (req, res) => {
    try {
      const doc = await HushAIConversation.findOne(keyFor(req)).lean();
      if (!doc) return res.json({ empty: true, version: 0 });
      res.json(toWire(doc));
    } catch (err) {
      console.error(`[hush-ai:${featureKey}] conversation load error:`, err.message);
      res.status(500).json({ error: 'Could not load conversation.' });
    }
  };

  // PUT /:feature/ai/conversation/:id — persist transcript + rewind state under an optimistic
  // lock. Never writes contextSummary/summarizedThrough (owned by the server's onEnd sink).
  const saveConversation = async (req, res) => {
    try {
      const body = req.body || {};
      const baseVersion = typeof body.baseVersion === 'number' ? body.baseVersion : 0;
      const state = {
        messages: Array.isArray(body.messages) ? body.messages : [],
        turns: Array.isArray(body.turns) ? body.turns : [],
        branches: body.branches && typeof body.branches === 'object' ? body.branches : {},
        pendingMutations: Array.isArray(body.pendingMutations) ? body.pendingMutations : [],
        activeTurnIndex: typeof body.activeTurnIndex === 'number' ? body.activeTurnIndex : null,
      };
      if (tooLarge(state)) {
        return res.status(413).json({ error: 'too_large', maxBytes: CONVERSATION_MAX_BODY_BYTES });
      }

      const filter = keyFor(req);
      const conflict = async () => {
        const current = await HushAIConversation.findOne(filter).lean();
        return res.status(409).json({
          error: 'conflict',
          ...(current ? toWire(current) : { empty: true, version: 0 }),
        });
      };

      const existing = await HushAIConversation.findOne(filter, { clientVersion: 1 }).lean();

      if (!existing) {
        // A client holding a version for a record that no longer exists was cleared elsewhere.
        if (baseVersion !== 0) return conflict();
        try {
          const created = await HushAIConversation.create({
            ...filter, ...state, clientVersion: 1, contextSummary: '', summarizedThrough: 0,
          });
          return res.json({ ok: true, version: created.clientVersion });
        } catch (err) {
          if (err?.code === 11000) return conflict(); // lost the insert race
          throw err;
        }
      }

      const updated = await HushAIConversation.findOneAndUpdate(
        { ...filter, clientVersion: baseVersion },
        { $set: state, $inc: { clientVersion: 1 } },
        { new: true },
      ).lean();

      if (!updated) return conflict(); // someone else wrote since this client last read
      res.json({ ok: true, version: updated.clientVersion });
    } catch (err) {
      console.error(`[hush-ai:${featureKey}] conversation save error:`, err.message);
      res.status(500).json({ error: 'Could not save conversation.' });
    }
  };

  // DELETE /:feature/ai/conversation/:id — clear the whole conversation.
  const clearConversation = async (req, res) => {
    try {
      await HushAIConversation.deleteOne(keyFor(req));
      res.json({ ok: true });
    } catch (err) {
      console.error(`[hush-ai:${featureKey}] conversation clear error:`, err.message);
      res.status(500).json({ error: 'Could not clear conversation.' });
    }
  };

  return { loadConversation, saveConversation, clearConversation };
}

// Non-HTTP sink used by the streaming chat's onEnd hook. Writes ONLY the server-owned rolling
// summary — disjoint from the client's fields, so it stays outside the optimistic lock and can
// never bump the version out from under an in-flight client save.
async function saveRollingSummary({ userId, featureKey, resourceId, contextSummary, summarizedThrough }) {
  try {
    if (!userId || !resourceId || !featureKey || typeof contextSummary !== 'string') return;
    const set = { contextSummary };
    if (typeof summarizedThrough === 'number') set.summarizedThrough = summarizedThrough;
    await HushAIConversation.findOneAndUpdate(
      { user: userId, featureKey, resourceId },
      { $set: set, $setOnInsert: { messages: [] } },
      { upsert: true },
    );
  } catch (err) {
    console.error(`[hush-ai:${featureKey}] saveRollingSummary error:`, err.message);
  }
}

// Read just the stored rolling summary for a conversation (used by the chat context layer).
async function loadContextSummary({ userId, featureKey, resourceId }) {
  try {
    if (!userId || !resourceId || !featureKey) return { contextSummary: '', summarizedThrough: 0 };
    const doc = await HushAIConversation.findOne(
      { user: userId, featureKey, resourceId },
      { contextSummary: 1, summarizedThrough: 1 },
    ).lean();
    return { contextSummary: doc?.contextSummary || '', summarizedThrough: doc?.summarizedThrough || 0 };
  } catch (_) {
    return { contextSummary: '', summarizedThrough: 0 };
  }
}

module.exports = {
  createConversationHandlers,
  saveRollingSummary,
  loadContextSummary,
};
