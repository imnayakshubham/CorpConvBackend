const mongoose = require('mongoose');

// Per-user store of previously-used survey tags. Powers tag suggestions in the
// Create/Edit Survey modal. `name` is the lowercased dedupe key; `display_name`
// preserves the original casing the user typed.
const tagSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },
    display_name: {
        type: String,
        required: true,
        trim: true
    },
    created_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});

// A tag is unique per user (case-insensitive via the lowercased `name`).
tagSchema.index({ name: 1, created_by: 1 }, { unique: true });

module.exports = mongoose.model('Tag', tagSchema);
