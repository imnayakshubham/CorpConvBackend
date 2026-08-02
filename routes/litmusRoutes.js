const express = require('express');
const { protect, optionalAuth } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { writeLimiter, submissionLimiter } = require('../middleware/rateLimiter');
// Still needed here: /re-evaluate is quota-metered. The /ai/* routes live in ai/routes/litmusAiRoutes.js.
const aiQuota = require('../ai/middleware/aiQuotaMiddleware');

const {
    createLitmus,
    quickCreateLitmus,
    editLitmus,
    listLitmus,
    getLitmusOwner,
    getLitmusPublic,
    verifyPin,
    submitLitmus,
    getSubmissions,
    reEvaluateSubmission,
    deleteLitmus,
    duplicateLitmus,
    regenerateLitmus,
} = require('../controllers/litmusControllers');
const {
    createLitmusBody,
    quickCreateBody,
    editLitmusBody,
    litmusSubmissionBody,
    verifyPinBody,
    listQuery,
    refParam,
    submissionIdParam,
    slugParam,
} = require('../validators/litmusSchemas');

const router = express.Router();

// ── CRUD / results (owner) ───────────────────────────────────────────────────────────
router.post('/create', protect, writeLimiter, validate({ body: createLitmusBody }), createLitmus);
router.post('/quick-create', protect, writeLimiter, validate({ body: quickCreateBody }), quickCreateLitmus);
router.get('/list', protect, validate({ query: listQuery }), listLitmus);
router.put('/edit/:ref', protect, writeLimiter, validate({ params: refParam, body: editLitmusBody }), editLitmus);
router.get('/own/:ref', protect, validate({ params: refParam }), getLitmusOwner);
router.get('/submissions/:ref', protect, validate({ params: refParam }), getSubmissions);
router.post('/duplicate/:ref', protect, writeLimiter, validate({ params: refParam }), duplicateLitmus);
router.post('/regenerate/:ref', protect, writeLimiter, aiQuota, validate({ params: refParam }), regenerateLitmus);
router.post('/re-evaluate/:submissionId', protect, writeLimiter, aiQuota, validate({ params: submissionIdParam }), reEvaluateSubmission);
router.delete('/:ref', protect, validate({ params: refParam }), deleteLitmus);

// ── Respondent (public, PIN-gated) ────────────────────────────────────────────────────
router.post('/verify-pin/:slug', submissionLimiter, validate({ params: slugParam, body: verifyPinBody }), verifyPin);
router.post('/submit/:slug', optionalAuth, submissionLimiter, validate({ params: slugParam, body: litmusSubmissionBody }), submitLitmus);

// Dynamic slug route LAST so it never swallows the static routes above.
router.get('/:slug', optionalAuth, validate({ params: slugParam }), getLitmusPublic);

module.exports = router;
