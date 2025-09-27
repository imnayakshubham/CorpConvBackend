const mongoose = require('mongoose');

const ActivityStoreSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    activityCount: {
        type: Number,
        default: 0
    },
    lastActiveAt: {
        type: Date,
        default: Date.now
    },
    lastActions: [{
        action: String,
        path: String,
        timestamp: {
            type: Date,
            default: Date.now
        }
    }]
}, {
    timestamps: true
});

// Method to record activity
ActivityStoreSchema.methods.record = async function (actionDetails) {
    this.activityCount += 1;
    this.lastActiveAt = new Date();
    this.lastActions.unshift({
        action: actionDetails.action,
        path: actionDetails.path,
        timestamp: new Date()
    });

    // Limit stored actions to most recent 10
    if (this.lastActions.length > 10) {
        this.lastActions = this.lastActions.slice(0, 10);
    }

    return this.save();
};

module.exports = mongoose.model('ActivityStore', ActivityStoreSchema);
