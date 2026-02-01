const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
    link_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Link',
        required: true,
        index: true,
    },
    referral_user_id: { type: String, required: true },
    click_count: { type: Number, default: 1 },
    first_click_at: { type: Date, default: Date.now },
    last_click_at: { type: Date, default: Date.now },
}, { timestamps: true });

referralSchema.index({ link_id: 1, referral_user_id: 1 }, { unique: true });

module.exports = mongoose.model('Referral', referralSchema);
