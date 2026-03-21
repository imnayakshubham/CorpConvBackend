const mongoose = require('mongoose');

const blockSchema = new mongoose.Schema({
    block_type: {
        type: String,
        required: true,
        enum: [
            'link', 'image', 'text', 'embed',
            'title', 'textCard', 'linkedin', 'github',
            'twitter', 'instagram', 'youtube', 'email',
            'greenText', 'upwork', 'iconCard', 'map',
        ],
    },
    size: {
        type: String,
        enum: ['small', 'medium', 'large'],
        default: 'small',
    },
    order: { type: Number, default: 0 },
    // grid layout
    layout: {
        x: { type: Number, default: 0 },
        y: { type: Number, default: 0 },
        w: { type: Number, default: 4, min: 1, max: 12 },
        h: { type: Number, default: 3, min: 1, max: 20 },
        minW: { type: Number, default: 1 },
        minH: { type: Number, default: 1 },
    },
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
    // content fields for frontend parity
    name: { type: String, maxlength: 200, default: '' },
    role: { type: String, maxlength: 100, default: '' },
    email_address: { type: String, maxlength: 254, default: '' },
    src: { type: String, maxlength: 2000, default: '' },
    location: { type: String, maxlength: 200, default: '' },
    text: { type: String, maxlength: 2000, default: '' },
    // link metadata (auto-extracted)
    link_metadata: {
        meta_title: { type: String, maxlength: 200, default: '' },
        meta_description: { type: String, maxlength: 500, default: '' },
        meta_image: { type: String, maxlength: 2000, default: '' },
        favicon: { type: String, maxlength: 2000, default: '' },
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
        blocks: [blockSchema],
        published_blocks: [blockSchema],
        vibe: {
            theme: { type: String, maxlength: 30, default: 'dark' },
            font: { type: String, maxlength: 50, default: 'font-sans' },
            radius: { type: String, maxlength: 50, default: 'rounded-[1.8rem]' },
        },
        version: { type: Number, default: 0 },
    },
    { timestamps: true }
);

bentoProfileSchema.index({ user_id: 1 }, { unique: true });

module.exports = mongoose.model('Profile', bentoProfileSchema);
