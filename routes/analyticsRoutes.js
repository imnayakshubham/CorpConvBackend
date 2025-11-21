const express = require('express');
const router = express.Router();
const { getDetailedAnalytics, getOverviewAnalytics } = require('../controllers/analyticsController');
const { protect } = require('../middleware/authMiddleware');

router.get('/survey/:id/analytics/detailed', protect, getDetailedAnalytics);
router.get('/analytics/overview', protect, getOverviewAnalytics);

module.exports = router;
