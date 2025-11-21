// models/Profile.js
const mongoose = require('mongoose');

const LayoutItemSchema = new mongoose.Schema({
    i: { type: String, required: true },
    x: { type: Number, required: true, min: 0 },
    y: { type: Number, required: true, min: 0 },
    w: { type: Number, required: true, min: 1 },
    h: { type: Number, required: true, min: 1 },
    minW: { type: Number },
    minH: { type: Number },
    maxW: { type: Number },
    maxH: { type: Number },
    static: { type: Boolean, default: false },
}, { _id: false });

const ResponsiveLayoutsSchema = new mongoose.Schema({
    lg: { type: [LayoutItemSchema], default: [] },
    md: { type: [LayoutItemSchema], default: [] },
    sm: { type: [LayoutItemSchema], default: [] },
    xs: { type: [LayoutItemSchema], default: [] },
    xxs: { type: [LayoutItemSchema], default: [] },
}, { _id: false });

const ProfileItemSchema = new mongoose.Schema({
    // Keep only metadata/content here (not layout)
    type: {
        type: String,
        enum: ['title', 'text', 'image', 'links', 'socialLink', 'category'],
        required: true
    }, // enums are a built-in validator in Mongoose
    content: { type: String, default: null },
    name: { type: String, default: null },
    img_url: { type: String, default: null },
    link: { type: String, default: null },
    parent_id: { type: mongoose.Schema.Types.ObjectId, default: null }, // Reference to parent category
    category_order: { type: Number, default: 0 }, // Order within category
    width: { type: Number, default: null }, // Custom width in pixels (for resizable items)
    height: { type: Number, default: null }, // Custom height in pixels (for resizable items)
    bookmarked_by: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    liked_by: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    access: { type: Boolean, default: true }
}, { timestamps: true, strict: false });

const ProfileSchema = new mongoose.Schema({
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // layouts are stored separately, per breakpoint
    layouts: { type: ResponsiveLayoutsSchema, default: () => ({}) },
    // items holds the content/metadata
    items: { type: [ProfileItemSchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('ProfileDetails', ProfileSchema);
