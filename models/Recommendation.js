// models/Recommendation.js
const mongoose = require('mongoose');

const RecommendationSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: [{
        user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        recommendation_value: Number
    }],
    created_at: { type: Date, default: Date.now }
}, { _id: false, timestamps: true });

RecommendationSchema.index({ user_id: 1, created_at: -1 });

module.exports = mongoose.model('Recommendation', RecommendationSchema);
