const mongoose = require('mongoose');

const clickSchema = new mongoose.Schema({
    link_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Link',
        required: true,
        index: true,
    },
    timestamp: { type: Date, default: Date.now },
    user_agent: { type: String },
    ip_address: { type: String },
    referrer: { type: String },
    referral_user_id: { type: String, default: null, index: true },
    is_unique: { type: Boolean, default: true },
}, { timestamps: true });

clickSchema.index({ link_id: 1, timestamp: -1 });
clickSchema.index({ link_id: 1, ip_address: 1 });

module.exports = mongoose.model('Click', clickSchema);
