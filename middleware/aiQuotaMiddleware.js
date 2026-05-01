const User = require('../models/userModel');

const FREE_LIMIT = 15;

module.exports = async function aiQuota(req, res, next) {
    try {
        const userId = req.user._id || req.user.id;
        const user = await User.findById(userId, { current_plan: 1, ai_calls_this_month: 1 }).lean();

        const calls = user?.ai_calls_this_month ?? 0;
        const isPaid = user?.current_plan && user.current_plan !== 'free';
        const limit = isPaid ? Infinity : FREE_LIMIT;

        if (calls >= limit) {
            return res.status(429).json({ error: 'quota_exceeded', used: calls, limit: FREE_LIMIT });
        }

        req.aiQuota = { used: calls, limit: FREE_LIMIT };

        res.on('finish', async () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                await User.updateOne({ _id: userId }, { $inc: { ai_calls_this_month: 1 } });
            }
        });

        next();
    } catch (err) {
        next(err);
    }
};
