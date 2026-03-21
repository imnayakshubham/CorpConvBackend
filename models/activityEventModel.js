const mongoose = require('mongoose');

const activityEventSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    eventType: {
        type: String,
        enum: ['login', 'post_created', 'survey_created', 'link_created', 'question_asked', 'message_sent'],
        required: true
    }
}, { timestamps: true });

activityEventSchema.index({ userId: 1, createdAt: -1 });
activityEventSchema.index({ eventType: 1, createdAt: -1 });
activityEventSchema.index({ createdAt: -1 });

const ActivityEvent = mongoose.model('ActivityEvent', activityEventSchema);
module.exports = ActivityEvent;
