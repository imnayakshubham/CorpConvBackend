const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { hushAiChat } = require('../controllers/hushAiController');
const { writeLimiter } = require('../middleware/rateLimiter');
const aiQuota = require('../middleware/aiQuotaMiddleware');
const User = require('../models/userModel');

const router = express.Router();

// protect → writeLimiter (30/min) → aiQuota (15/month free) → hushAiChat
router.post('/ai/chat/:id', protect, writeLimiter, aiQuota, hushAiChat);

router.get('/ai/quota', protect, async (req, res, next) => {
    try {
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
