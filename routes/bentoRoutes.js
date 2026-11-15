const express = require('express');
const { protect, optionalAuth } = require('../middleware/authMiddleware');
const {
    getPublicProfile,
    getMyProfile,
    upsertProfile,
    upsertSection,
    upsertBlock,
    deleteSection,
    deleteBlock,
    reorderItems,
    getBentoPageProfile,
    ogPreview,
} = require('../controllers/bentoController');
const validate = require('../middleware/validate');
const { writeLimiter } = require('../middleware/rateLimiter');
const {
    upsertProfileBody,
    upsertSectionBody,
    upsertBlockBody,
    deleteSectionBody,
    deleteBlockBody,
    reorderBody,
    usernameParam,
    idOrUsernameParam,
} = require('../validators/bentoSchemas');

const { revalidateOnSuccess } = require('../utils/frontendRevalidate');

const router = express.Router();

const revalidateBento = revalidateOnSuccess((req) => [`bento:${req.user?.username}`]);

// Literal routes MUST be registered before /:username
router.route('/me').get(protect, getMyProfile);
router.route('/og-preview').get(protect, writeLimiter, ogPreview);
router.route('/profile').post(protect, writeLimiter, validate({ body: upsertProfileBody }), revalidateBento, upsertProfile);
router.route('/section').patch(protect, writeLimiter, validate({ body: upsertSectionBody }), revalidateBento, upsertSection);
router.route('/section').delete(protect, writeLimiter, validate({ body: deleteSectionBody }), revalidateBento, deleteSection);
router.route('/block').patch(protect, writeLimiter, validate({ body: upsertBlockBody }), revalidateBento, upsertBlock);
router.route('/block').delete(protect, writeLimiter, validate({ body: deleteBlockBody }), revalidateBento, deleteBlock);
router.route('/reorder').patch(protect, writeLimiter, validate({ body: reorderBody }), revalidateBento, reorderItems);

// --- Bento Page API ---
router.route('/user/:id_or_username/profile')
    .get(optionalAuth, validate({ params: idOrUsernameParam }), getBentoPageProfile);

// Public profile  - must be LAST
router.route('/:username').get(validate({ params: usernameParam }), getPublicProfile);

module.exports = router;
