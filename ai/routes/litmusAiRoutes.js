// Litmus AI question-builder routes. Mounted at /api/litmus ahead of the CRUD router so the
// static /ai/* paths are matched before its dynamic /:slug route.

const express = require('express');
const { protect } = require('../../middleware/authMiddleware');
const { writeLimiter } = require('../../middleware/rateLimiter');
const aiQuota = require('../middleware/aiQuotaMiddleware');
const { isSuperAdmin } = require('../../middleware/superAdminMiddleware');
const User = require('../../models/userModel');
const { litmusAiChat, litmusAiSummarize } = require('../controllers/litmusAiController');
const { createConversationHandlers } = require('../controllers/hushAiConversationController');
const litmusAgent = require('../agents/litmus');
const { FREE_MONTHLY_CALLS } = require('../core/config');

const router = express.Router();

// Conversation store namespaced by the plugin key, so it never collides with the survey's.
const { loadConversation, saveConversation, clearConversation } =
    createConversationHandlers(litmusAgent.key);

// protect → writeLimiter → aiQuota → handler
router.post('/ai/chat/:id', protect, writeLimiter, aiQuota, litmusAiChat);
router.post('/ai/summarize/:id', protect, writeLimiter, aiQuota, litmusAiSummarize);
// Durable conversation store (NOT quota-metered — persistence must never burn the AI budget).
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
        const limit = FREE_MONTHLY_CALLS;
        res.json({ used, limit, remaining: Math.max(0, limit - used) });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
