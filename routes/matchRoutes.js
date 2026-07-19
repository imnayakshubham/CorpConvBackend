const express = require('express');
const { protect, optionalAuth } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { writeLimiter, submissionLimiter } = require('../middleware/rateLimiter');
const aiQuota = require('../middleware/aiQuotaMiddleware');
const { isSuperAdmin } = require('../middleware/superAdminMiddleware');
const User = require('../models/userModel');

const {
    createMatch,
    editMatch,
    listMatches,
    getMatchOwner,
    getMatchPublic,
    verifyPin,
    submitMatch,
    getSubmissions,
    reEvaluateSubmission,
    deleteMatch,
} = require('../controllers/matchControllers');
const {
    createMatchBody,
    editMatchBody,
    matchSubmissionBody,
    verifyPinBody,
    listQuery,
    idParam,
    submissionIdParam,
    slugParam,
} = require('../validators/matchSchemas');

const { matchAiChat, matchAiSummarize } = require('../controllers/matchAiController');
const { createConversationHandlers } = require('../controllers/hushAiConversationController');
const matchAgent = require('../features/matchAgent');

const router = express.Router();

// Conversation store namespaced by the plugin key, so it never collides with the survey's.
const { loadConversation, saveConversation, clearConversation } =
    createConversationHandlers(matchAgent.key);

// ── Hush AI question-builder (static, before /:slug) ─────────────────────────────────
// protect → writeLimiter → aiQuota (15/month free) → handler
router.post('/ai/chat/:id', protect, writeLimiter, aiQuota, matchAiChat);
router.post('/ai/summarize/:id', protect, writeLimiter, aiQuota, matchAiSummarize);
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
        const limit = 15;
        res.json({ used, limit, remaining: Math.max(0, limit - used) });
    } catch (err) {
        next(err);
    }
});

// ── CRUD / results (owner) ───────────────────────────────────────────────────────────
router.post('/create', protect, writeLimiter, validate({ body: createMatchBody }), createMatch);
router.get('/list', protect, validate({ query: listQuery }), listMatches);
router.put('/edit/:id', protect, writeLimiter, validate({ params: idParam, body: editMatchBody }), editMatch);
router.get('/own/:id', protect, validate({ params: idParam }), getMatchOwner);
router.get('/submissions/:id', protect, validate({ params: idParam }), getSubmissions);
router.post('/re-evaluate/:submissionId', protect, writeLimiter, aiQuota, validate({ params: submissionIdParam }), reEvaluateSubmission);
router.delete('/:id', protect, validate({ params: idParam }), deleteMatch);

// ── Respondent (public, PIN-gated) ────────────────────────────────────────────────────
router.post('/verify-pin/:slug', submissionLimiter, validate({ params: slugParam, body: verifyPinBody }), verifyPin);
router.post('/submit/:slug', optionalAuth, submissionLimiter, validate({ params: slugParam, body: matchSubmissionBody }), submitMatch);

// Dynamic slug route LAST so it never swallows the static routes above.
router.get('/:slug', optionalAuth, validate({ params: slugParam }), getMatchPublic);

module.exports = router;
