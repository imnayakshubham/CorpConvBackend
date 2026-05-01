const cron = require('cron');
const User = require('../models/userModel');

// Fires at 00:00 UTC on the 1st of every month
const job = new cron.CronJob('0 0 1 * *', async () => {
    try {
        const result = await User.updateMany({}, { $set: { ai_calls_this_month: 0 } });
        console.log(`[AI Quota] Monthly counters reset — ${result.modifiedCount} users updated`);
    } catch (err) {
        console.error('[AI Quota] Failed to reset monthly counters:', err.message);
    }
});

module.exports = { job };
