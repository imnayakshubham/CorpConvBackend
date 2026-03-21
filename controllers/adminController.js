const User = require('../models/userModel');
const ActivityEvent = require('../models/activityEventModel');
const Post = require('../models/postModel');
const { Survey } = require('../models/surveyModel');
const Link = require('../models/linkModel');
const cache = require('../redisClient/cacheHelper');
const TTL = require('../redisClient/cacheTTL');

const getRangeDays = (range) => {
    switch (range) {
        case '90d': return 90;
        case '30d': return 30;
        case '7d':
        default: return 7;
    }
};

const getPlatformStats = async (req, res) => {
    try {
        const cacheKey = cache.generateKey('admin', 'platform-stats');
        const cached = await cache.get(cacheKey);
        if (cached) return res.status(200).json({ status: 'Success', data: cached });

        const now = new Date();
        const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
        const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

        const [totalUsers, activeToday, newThisWeek, totalPosts, totalSurveys, totalLinks] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ lastActiveAt: { $gte: oneDayAgo } }),
            User.countDocuments({ createdAt: { $gte: oneWeekAgo } }),
            Post.countDocuments({ access: true }),
            Survey.countDocuments(),
            Link.countDocuments(),
        ]);

        const data = { totalUsers, activeToday, newThisWeek, totalPosts, totalSurveys, totalLinks };
        await cache.set(cacheKey, data, TTL.ADMIN_PLATFORM_STATS);
        return res.status(200).json({ status: 'Success', data });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ status: 'Failed', message: 'Failed to fetch platform stats' });
    }
};

const getMostActiveUsers = async (req, res) => {
    try {
        const cacheKey = cache.generateKey('admin', 'active-users');
        const cached = await cache.get(cacheKey);
        if (cached) return res.status(200).json({ status: 'Success', data: cached });

        const users = await User.find({}, {
            public_user_name: 1,
            user_current_company_name: 1,
            loginCount: 1,
            lastLoginAt: 1,
            lastActiveAt: 1,
        }).sort({ loginCount: -1 }).limit(20);

        await cache.set(cacheKey, users, TTL.ADMIN_ACTIVE_USERS);
        return res.status(200).json({ status: 'Success', data: users });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ status: 'Failed', message: 'Failed to fetch active users' });
    }
};

const getUserActivityTrends = async (req, res) => {
    try {
        const range = req.query.range || '30d';
        const days = getRangeDays(range);
        const cacheKey = cache.generateKey('admin', 'activity-trends', range);
        const cached = await cache.get(cacheKey);
        if (cached) return res.status(200).json({ status: 'Success', data: cached });

        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const data = await ActivityEvent.aggregate([
            { $match: { eventType: 'login', createdAt: { $gte: startDate } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } },
            { $project: { _id: 0, date: '$_id', count: 1 } }
        ]);

        await cache.set(cacheKey, data, TTL.ADMIN_TRENDS);
        return res.status(200).json({ status: 'Success', data });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ status: 'Failed', message: 'Failed to fetch activity trends' });
    }
};

const getNewUsersTrend = async (req, res) => {
    try {
        const range = req.query.range || '30d';
        const days = getRangeDays(range);
        const cacheKey = cache.generateKey('admin', 'new-users-trend', range);
        const cached = await cache.get(cacheKey);
        if (cached) return res.status(200).json({ status: 'Success', data: cached });

        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const data = await User.aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } },
            { $project: { _id: 0, date: '$_id', count: 1 } }
        ]);

        await cache.set(cacheKey, data, TTL.ADMIN_TRENDS);
        return res.status(200).json({ status: 'Success', data });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ status: 'Failed', message: 'Failed to fetch new users trend' });
    }
};

const getFeatureUsageTrend = async (req, res) => {
    try {
        const range = req.query.range || '30d';
        const days = getRangeDays(range);
        const cacheKey = cache.generateKey('admin', 'feature-usage', range);
        const cached = await cache.get(cacheKey);
        if (cached) return res.status(200).json({ status: 'Success', data: cached });

        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const data = await ActivityEvent.aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            {
                $group: {
                    _id: '$eventType',
                    count: { $sum: 1 }
                }
            },
            { $project: { _id: 0, label: '$_id', count: 1 } }
        ]);

        await cache.set(cacheKey, data, TTL.ADMIN_TRENDS);
        return res.status(200).json({ status: 'Success', data });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ status: 'Failed', message: 'Failed to fetch feature usage' });
    }
};

module.exports = {
    getPlatformStats,
    getMostActiveUsers,
    getUserActivityTrends,
    getNewUsersTrend,
    getFeatureUsageTrend,
};
