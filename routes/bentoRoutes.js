const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const {
    getPublicProfile,
    getMyProfile,
    upsertProfile,
    upsertSection,
    upsertBlock,
    deleteSection,
    deleteBlock,
    reorderItems,
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

// Public profile — must be LAST
router.route('/:username').get(validate({ params: usernameParam }), getPublicProfile);

module.exports = router;
