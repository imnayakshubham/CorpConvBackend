// routes/recommendation.js (excerpt)
const express = require('express');
const Recommendation = require('../models/Recommendation');
const User = require('../models/userModel');
const { recommendationQueue } = require('../queues');
const router = express.Router();

const CACHE_TTL_MINUTES = parseInt(process.env.RECOMM_CACHE_TTL_MINUTES || '60', 10);
const RECENT_DAYS = parseInt(process.env.RECENT_ACTIVE_DAYS || '14', 10);

function isCacheFresh(rec) {
    if (!rec) return false;
    const ageMin = (Date.now() - new Date(rec.generatedAt).getTime()) / (60 * 1000);
    return ageMin <= CACHE_TTL_MINUTES;
}

function paginate(list, limit) {
    const hasMore = list.length > limit;
    const results = hasMore ? list.slice(0, limit) : list;
    const nextCursor = hasMore ? list[limit]._id.toString() : null;
    return { results, nextCursor };
}


router.get('/recommendation/:user_id?', async (req, res) => {
    console.log("hrtrr")

    try {
        const user_id = req.params.user_id || null;
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);
        const cursor = req.query.cursor || null;

        // Build filter for recently active users
        const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 3600 * 1000);
        const filter = {
            last_active_at: { $gte: cutoff },
            ...(user_id ? { _id: { $ne: user_id } } : {}),
            ...(cursor ? { _id: { $gt: cursor } } : {})
        };

        const projection = {};

        if (!user_id) {
            const users = await User.find(filter, projection)
                .sort({ _id: 1 })
                .limit(limit + 1)
                .lean();

            const { results: records, nextCursor } = paginate(users, limit);

            await recommendationQueue.add('compute', { user_id, limit: 1000 }, {
                removeOnComplete: true,
                removeOnFail: true,
            });

            return res.success({
                status: "Success",
                message: "Users fetched",
                result: { data: records, nextCursor }
            });
        }

        const user = await User.findById(user_id, projection).lean();
        if (!user) {
            return res.error({
                status: "Error",
                message: "User not found",
                result: null,
                code: 404
            });
        }

        const recDoc = await Recommendation.findOne({ user_id });

        if (!recDoc || !isCacheFresh(recDoc)) {
            const users = await User.find(filter)
                .sort({ last_active_at: -1 })
                .limit(limit)
                .lean();

            await recommendationQueue.add('compute', { user_id, limit: 1000 }, {
                removeOnComplete: true,
                removeOnFail: true,
            });

            const nextCursor = users.length === limit
                ? users[users.length - 1]._id.toString()
                : null;

            return res.success({
                status: "Success",
                message: "Users fetched (pending recommendations)",
                result: {
                    data: users,
                    nextCursor
                }
            });
        }

        // Serve cached recommendations
        const items = recDoc.items || [];
        const startIdx = cursor
            ? items.findIndex(i => i.user_id.toString() === cursor) + 1
            : 0;

        const pageItems = items.slice(startIdx, startIdx + limit);
        const nextCursorRec = pageItems.length === limit
            ? pageItems[pageItems.length - 1].user_id.toString()
            : null;

        const users = pageItems.length
            ? await User.find({ _id: { $in: pageItems.map(p => p.user_id) } }).lean()
            : [];

        const byId = users.reduce((acc, u) => {
            acc[u._id.toString()] = u;
            return acc;
        }, {});

        const enriched = pageItems.map(p => ({
            id: p.user_id,
            recommendation_value: p.recommendation_value,
            profile: byId[p.user_id.toString()] || null
        }));

        return res.success({
            status: "Success",
            message: "Recommendations fetched",
            result: { data: enriched, nextCursor: nextCursorRec }
        });
    } catch (error) {

    }
});


module.exports = router;
