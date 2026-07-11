const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { hushAiChat, hushAiSummarize } = require('../controllers/hushAiController');
const { createConversationHandlers } = require('../controllers/hushAiConversationController');
const surveyAgent = require('../features/surveyAgent');
const { writeLimiter } = require('../middleware/rateLimiter');
const aiQuota = require('../middleware/aiQuotaMiddleware');
const { isSuperAdmin } = require('../middleware/superAdminMiddleware');
const User = require('../models/userModel');

const router = express.Router();

// Records are namespaced by the plugin's key, so a sibling feature mounts its own conversation
// routes by calling this with its own plugin.
const { loadConversation, saveConversation, clearConversation } =
  createConversationHandlers(surveyAgent.key);

// protect → writeLimiter (30/min) → aiQuota (15/month free) → hushAiChat
router.post('/ai/chat/:id', protect, writeLimiter, aiQuota, hushAiChat);

// Condense a conversation slice for the rewind "Summarize" options.
router.post('/ai/summarize/:id', protect, writeLimiter, aiQuota, hushAiSummarize);

// Durable conversation store (cross-device). NOT quota-metered — persistence must never burn
// the monthly AI budget. The PUT is the sole writer of the transcript AND the rewind/branch
// state; the chat's onEnd hook writes only the rolling summary. PUT carries a `baseVersion`
// and 409s on a stale write rather than clobbering.
router.get('/ai/conversation/:id', protect, loadConversation);
router.put('/ai/conversation/:id', protect, writeLimiter, saveConversation);
router.delete('/ai/conversation/:id', protect, writeLimiter, clearConversation);

router.get('/ai/quota', protect, async (req, res, next) => {
    try {
        if (isSuperAdmin(req.user)) {
            return res.json({ used: 0, limit: null, remaining: null, unlimited: true });
        }
        const userId = req.user._id || req.user.id;
        const user = await User.findById(userId, { ai_calls_this_month: 1 }).lean();
        const used = user?.ai_calls_this_month ?? 0;
        const limit = 15;
        res.json({ used, limit, remaining: Math.max(0, limit - used) });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
