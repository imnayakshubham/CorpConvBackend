const express = require('express');
const { protect, optionalAuth } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { writeLimiter, submissionLimiter } = require('../middleware/rateLimiter');
// Still needed here: /re-evaluate is quota-metered. The /ai/* routes live in ai/routes/litmusAiRoutes.js.
const aiQuota = require('../ai/middleware/aiQuotaMiddleware');

const {
    createLitmus,
    editLitmus,
    listLitmus,
    getLitmusOwner,
    getLitmusPublic,
    verifyPin,
    submitLitmus,
    getSubmissions,
    reEvaluateSubmission,
    deleteLitmus,
} = require('../controllers/litmusControllers');
const {
    createLitmusBody,
    editLitmusBody,
    litmusSubmissionBody,
    verifyPinBody,
    listQuery,
    idParam,
    submissionIdParam,
    slugParam,
} = require('../validators/litmusSchemas');

const router = express.Router();

// ── CRUD / results (owner) ───────────────────────────────────────────────────────────
router.post('/create', protect, writeLimiter, validate({ body: createLitmusBody }), createLitmus);
router.get('/list', protect, validate({ query: listQuery }), listLitmus);
router.put('/edit/:id', protect, writeLimiter, validate({ params: idParam, body: editLitmusBody }), editLitmus);
router.get('/own/:id', protect, validate({ params: idParam }), getLitmusOwner);
router.get('/submissions/:id', protect, validate({ params: idParam }), getSubmissions);
router.post('/re-evaluate/:submissionId', protect, writeLimiter, aiQuota, validate({ params: submissionIdParam }), reEvaluateSubmission);
router.delete('/:id', protect, validate({ params: idParam }), deleteLitmus);

// ── Respondent (public, PIN-gated) ────────────────────────────────────────────────────
router.post('/verify-pin/:slug', submissionLimiter, validate({ params: slugParam, body: verifyPinBody }), verifyPin);
router.post('/submit/:slug', optionalAuth, submissionLimiter, validate({ params: slugParam, body: litmusSubmissionBody }), submitLitmus);

// Dynamic slug route LAST so it never swallows the static routes above.
router.get('/:slug', optionalAuth, validate({ params: slugParam }), getLitmusPublic);

module.exports = router;
