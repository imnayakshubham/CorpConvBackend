const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { superAdmin } = require('../middleware/superAdminMiddleware');
const { adminLimiter } = require('../middleware/rateLimiter');
const {
    getPlatformStats,
    getMostActiveUsers,
    getUserActivityTrends,
    getNewUsersTrend,
    getFeatureUsageTrend,
} = require('../controllers/adminController');

router.get('/admin/platform-stats', protect, superAdmin, adminLimiter, getPlatformStats);
router.get('/admin/most-active-users', protect, superAdmin, adminLimiter, getMostActiveUsers);
router.get('/admin/activity-trends', protect, superAdmin, adminLimiter, getUserActivityTrends);
router.get('/admin/new-users-trend', protect, superAdmin, adminLimiter, getNewUsersTrend);
router.get('/admin/feature-usage', protect, superAdmin, adminLimiter, getFeatureUsageTrend);

module.exports = router;
