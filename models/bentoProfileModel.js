const mongoose = require('mongoose');

const blockSchema = new mongoose.Schema({
    block_type: {
        type: String,
        required: true,
        enum: ['link', 'image', 'text', 'embed'],
    },
    size: {
        type: String,
        enum: ['small', 'medium', 'large'],
        default: 'small',
    },
    order: { type: Number, default: 0 },
    // link fields
    title: { type: String, maxlength: 200, default: '' },
    subtitle: { type: String, maxlength: 300, default: '' },
    url: { type: String, maxlength: 2000, default: '' },
    icon_url: { type: String, maxlength: 2000, default: '' },
    image_url: { type: String, maxlength: 2000, default: '' },
    // text fields
    text_content: { type: String, maxlength: 2000, default: '' },
    background_color: { type: String, maxlength: 20, default: '#1a1a1a' },
    text_color: { type: String, maxlength: 20, default: '#ffffff' },
    // embed fields
    embed_url: { type: String, maxlength: 2000, default: '' },
    embed_type: {
        type: String,
        enum: ['youtube', 'spotify', 'twitter', 'other', ''],
        default: '',
    },
});

const sectionSchema = new mongoose.Schema({
    title: { type: String, maxlength: 100, default: 'Untitled Section' },
    order: { type: Number, default: 0 },
    blocks: [blockSchema],
});

const bentoProfileSchema = new mongoose.Schema(
    {
        user_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
        },
        is_published: { type: Boolean, default: false },
        sections: [sectionSchema],
        published_sections: [sectionSchema],
        version: { type: Number, default: 0 },
    },
    { timestamps: true }
);

bentoProfileSchema.index({ user_id: 1 }, { unique: true });

module.exports = mongoose.model('Profile', bentoProfileSchema);
