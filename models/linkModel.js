const mongoose = require('mongoose');

const linkSchema = new mongoose.Schema({
    posted_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    access: {
        type: Boolean,
        default: true
    },
    is_verified_source: {
        type: Boolean,
        default: false
    },
    category: {
        type: String,
        trim: true,
        required: true,
        maxlength: 50,
        set: (val) => val?.replace(/<[^>]*>/g, '').trim()
    },
    link_data: {
        url: {
            type: String,
            required: true
        },
        title: String,
        description: String,
        image: String,
        favicon: String,
        author: String
    },
    posted_at: {
        type: Date,
        default: Date.now,
    },
    bookmarked_by: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
    ],
    liked_by: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
    ],
    view_count: {
        type: Number,
        default: 0
    },
    click_count: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

// Indexes for better query performance
linkSchema.index({ category: 1 });
linkSchema.index({ posted_by: 1 });
linkSchema.index({ 'link_data.url': 1 }, { unique: true });

module.exports = mongoose.model('Link', linkSchema);
