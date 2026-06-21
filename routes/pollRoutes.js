const express = require('express');
const { protect, optionalAuth } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { writeLimiter, submissionLimiter } = require('../middleware/rateLimiter');
const {
    createPoll,
    getPolls,
    getPollBySlug,
    castVote,
    updatePollSettings,
    deletePoll,
    getPollAnalytics,
    verifyPin,
} = require('../controllers/pollControllers');
const {
    createPollBody,
    castVoteBody,
    updatePollSettingsBody,
    verifyPinBody,
    getPollsQuery,
    pollIdParam,
    pollSlugParam,
} = require('../validators/pollSchemas');

const router = express.Router();

// Static routes first to avoid conflict with /:slug
router.route('/').get(optionalAuth, validate({ query: getPollsQuery }), getPolls);
router.route('/create').post(protect, writeLimiter, validate({ body: createPollBody }), createPoll);
router.route('/vote/:id').post(optionalAuth, submissionLimiter, validate({ params: pollIdParam, body: castVoteBody }), castVote);
router.route('/settings/:id').patch(protect, writeLimiter, validate({ params: pollIdParam, body: updatePollSettingsBody }), updatePollSettings);
router.route('/verify-pin/:id').post(submissionLimiter, validate({ params: pollIdParam, body: verifyPinBody }), verifyPin);
router.route('/delete/:id').delete(protect, validate({ params: pollIdParam }), deletePoll);
router.route('/analytics/:id').get(protect, validate({ params: pollIdParam }), getPollAnalytics);

// Dynamic slug route last
router.route('/:slug').get(optionalAuth, validate({ params: pollSlugParam }), getPollBySlug);

module.exports = router;
