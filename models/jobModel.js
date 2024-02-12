

// Create Job Schema with Mongoose and Bookmark and Like


const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
    job_posted_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    access: {
        type: Boolean,
        default: true
    },
    is_job_verified: {
        type: Boolean,
        default: false
    },
    job_data: {
        type: Object,
        required: true,
    },
    job_posted_at: {
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
}, { timestamps: true });

module.exports = mongoose.model('Job', jobSchema);