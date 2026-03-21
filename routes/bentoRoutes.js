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
    listBentoBlocks,
    updateBentoBlocks,
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
    updateBentoBlocksBody,
} = require('../validators/bentoSchemas');

const router = express.Router();

// Literal routes MUST be registered before /:username
router.route('/me').get(protect, getMyProfile);
router.route('/profile').post(protect, writeLimiter, validate({ body: upsertProfileBody }), upsertProfile);
router.route('/section').patch(protect, writeLimiter, validate({ body: upsertSectionBody }), upsertSection);
router.route('/section').delete(protect, writeLimiter, validate({ body: deleteSectionBody }), deleteSection);
router.route('/block').patch(protect, writeLimiter, validate({ body: upsertBlockBody }), upsertBlock);
router.route('/block').delete(protect, writeLimiter, validate({ body: deleteBlockBody }), deleteBlock);
router.route('/reorder').patch(protect, writeLimiter, validate({ body: reorderBody }), reorderItems);

// --- Bento Page API ---
router.route('/user/:id_or_username/profile')
    .get(optionalAuth, validate({ params: idOrUsernameParam }), getBentoPageProfile);

router.route('/user/:id_or_username/blocks')
    .get(optionalAuth, validate({ params: idOrUsernameParam }), listBentoBlocks)
    .post(protect, writeLimiter, validate({ params: idOrUsernameParam, body: updateBentoBlocksBody }), updateBentoBlocks);

// Public profile — must be LAST
router.route('/:username').get(validate({ params: usernameParam }), getPublicProfile);

module.exports = router;
