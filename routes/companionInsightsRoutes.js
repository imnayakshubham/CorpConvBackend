const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { getTimeline, getInsights, getInsightsNarrative } = require('../controllers/companionInsightsController');

const router = express.Router();

// Read-only progress views (per-user private).
router.route('/timeline').get(protect, getTimeline);
router.route('/insights').get(protect, getInsights);
router.route('/insights/narrative').get(protect, getInsightsNarrative);

module.exports = router;
