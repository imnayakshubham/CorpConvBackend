const express = require('express');
const { protect, optionalAuth } = require('../middleware/authMiddleware');
const {
    listBlocks,
    addBlock,
    updateBlock,
    deleteBlock,
    updateLayout,
    updateVibe,
    publishBlocks,
} = require('../controllers/blockController');
const validate = require('../middleware/validate');
const { writeLimiter } = require('../middleware/rateLimiter');
const {
    idOrUsernameParam,
    addBlockBody,
    updateBlockBody,
    deleteBlockBody,
    layoutsBody,
    vibeBody,
    publishBody,
} = require('../validators/blockSchemas');

const router = express.Router();

// Read — public (optionalAuth to detect is_owner)
router.get(
    '/:id_or_username/list',
    optionalAuth,
    validate({ params: idOrUsernameParam }),
    listBlocks
);

// Write — owner only, rate-limited
router.post(
    '/:id_or_username/add',
    protect,
    writeLimiter,
    validate({ params: idOrUsernameParam, body: addBlockBody }),
    addBlock
);

router.patch(
    '/:id_or_username/update',
    protect,
    writeLimiter,
    validate({ params: idOrUsernameParam, body: updateBlockBody }),
    updateBlock
);

router.delete(
    '/:id_or_username/delete',
    protect,
    writeLimiter,
    validate({ params: idOrUsernameParam, body: deleteBlockBody }),
    deleteBlock
);

router.patch(
    '/:id_or_username/layout',
    protect,
    writeLimiter,
    validate({ params: idOrUsernameParam, body: layoutsBody }),
    updateLayout
);

router.patch(
    '/:id_or_username/vibe',
    protect,
    writeLimiter,
    validate({ params: idOrUsernameParam, body: vibeBody }),
    updateVibe
);

router.patch(
    '/:id_or_username/publish',
    protect,
    writeLimiter,
    validate({ params: idOrUsernameParam, body: publishBody }),
    publishBlocks
);

module.exports = router;
