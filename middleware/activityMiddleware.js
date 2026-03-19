const User = require('../models/userModel');
const cache = require('../redisClient/cacheHelper');

const trackActivity = (req, res, next) => {
    if (!req.user) return next();

    const userId = req.user._id?.toString();
    if (!userId) return next();

    // Fire-and-forget: never delays the response
    (async () => {
        try {
            const key = cache.generateKey('lastActive', userId);
            const cached = await cache.get(key);
            if (cached) return;

            await User.updateOne({ _id: userId }, { $set: { lastActiveAt: new Date() } });
            await cache.set(key, '1', 900); // 15-min TTL
        } catch (e) {
            // silent fail
        }
    })();

    return next();
};

module.exports = { trackActivity };
