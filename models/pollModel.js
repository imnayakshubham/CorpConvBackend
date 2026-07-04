const mongoose = require('mongoose');
const crypto = require('crypto');

function generateSlug(text) {
    const base = (text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 50)
        .replace(/-+$/, '');
    const random = crypto.randomBytes(4).toString('hex');
    return base ? `${base}-${random}` : random;
}

const pollOptionSchema = new mongoose.Schema({
    text: { type: String, required: true, maxlength: 200 },
}, { _id: true });

const pollSchema = new mongoose.Schema({
    created_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    question: {
        type: String,
        required: true,
        maxlength: 300,
    },
    options: {
        type: [pollOptionSchema],
        validate: {
            validator: (v) => v.length >= 2 && v.length <= 6,
            message: 'A poll must have between 2 and 6 options.',
        },
    },
    allow_multiple_choice: { type: Boolean, default: false },
    visibility: {
        type: String,
        enum: ['public', 'logged_in', 'workspace'],
        default: 'public',
    },
    workspace_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    status: {
        type: String,
        // 'open' is a legacy synonym for 'published' kept here so pre-rename docs still validate on save.
        // Read paths normalize 'open' → 'published' before responding.
        enum: ['draft', 'published', 'closed', 'open'],
        default: 'draft',
    },
    closeAt: { type: Date, default: null },
    // `pins` holds AES-encrypted creator-visible access codes; `pin_hash` is a legacy single
    // hashed PIN kept only for verifying pre-existing polls until the creator regenerates codes.
    pin_enabled: { type: Boolean, default: false },
    pins: { type: [String], default: [], select: false },
    pin_hash: { type: String, default: null, select: false },
    slug: { type: String, unique: true },
    total_votes: { type: Number, default: 0 },
    access: { type: Boolean, default: true },
}, { timestamps: true });

pollSchema.pre('save', function (next) {
    if (!this.slug) {
        this.slug = generateSlug(this.question);
    }
    next();
});

pollSchema.index({ visibility: 1, status: 1, createdAt: -1 });
pollSchema.index({ created_by: 1, createdAt: -1 });
pollSchema.index({ total_votes: -1, createdAt: -1 });

const pollVoteSchema = new mongoose.Schema({
    poll_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Poll',
        required: true,
    },
    voter_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    },
    voter_fingerprint: {
        type: String,
        default: null,
    },
    option_ids: [{
        type: mongoose.Schema.Types.ObjectId,
        required: true,
    }],
}, { timestamps: true });

// sparse: true means null values are excluded from the index, allowing multiple anonymous votes per poll
pollVoteSchema.index({ poll_id: 1, voter_id: 1 }, { unique: true, sparse: true });
pollVoteSchema.index({ poll_id: 1, voter_fingerprint: 1 }, { unique: true, sparse: true });
pollVoteSchema.index({ poll_id: 1 });

const Poll = mongoose.model('Poll', pollSchema);
const PollVote = mongoose.model('PollVote', pollVoteSchema);

module.exports = { Poll, PollVote };
