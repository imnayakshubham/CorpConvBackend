// trackActivity.js
const ActivityStore = require('./models/ActivityStore');

module.exports = function trackActivityMiddleware(req, res, next) {
    res.on('finish', async () => {
        if (!req.user?._id) return;
        const actionDetails = { action: req.method, path: req.originalUrl };
        let store = await ActivityStore.findOne({ user: req.user._id });
        if (!store) store = new ActivityStore({ user: req.user._id });
        await store.record(actionDetails);
    });
    next();
};
