const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { hushAiChat } = require('../controllers/hushAiController');
const { writeLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Vercel AI SDK useChat sends messages in its own format + our surveyContext in body.
// protect handles auth; writeLimiter caps at 30 req/min per user.
router.post('/ai/chat/:id', protect, writeLimiter, hushAiChat);

module.exports = router;
