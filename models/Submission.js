const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
  field_id: {
    type: String,
    required: true
  },
  fileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FileUpload',
    required: true
  },
  fileName: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  }
});

const submissionSchema = new mongoose.Schema({
  // Support both formId (new) and survey_id (old) for backward compatibility
  formId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Survey',
    required: function() {
      return !this.survey_id;
    }
  },
  survey_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Survey',
    required: function() {
      return !this.formId;
    }
  },

  // Response data - flexible structure to handle any form fields
  // Supports both 'data' (new Map format) and 'submissions' (old array format)
  data: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    required: function() {
      return !this.submissions;
    }
  },
  submissions: [{
    type: mongoose.Schema.Types.Mixed,
    required: function() {
      return !this.data;
    }
  }],

  // User references - support both formats
  survey_answered_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  survey_created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Metadata
  submittedAt: {
    type: Date,
    default: Date.now
  },
  ipAddress: {
    type: String,
    select: false // Don't include in queries by default for privacy
  },
  userAgent: {
    type: String,
    select: false
  },

  // Session tracking
  sessionId: String,

  // Files attached to this submission
  attachments: [attachmentSchema],

  // Form validation status
  isValid: {
    type: Boolean,
    default: true
  },

  // Submission source
  source: {
    type: String,
    enum: ['web', 'embed', 'api'],
    default: 'web'
  },

  // Spam detection
  isSpam: {
    type: Boolean,
    default: false
  },
  spamScore: {
    type: Number,
    default: 0
  },

  // Backward compatibility
  access: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for better query performance
submissionSchema.index({ formId: 1, submittedAt: -1 });
submissionSchema.index({ survey_id: 1, createdAt: -1 });
submissionSchema.index({ formId: 1, isSpam: 1 });
submissionSchema.index({ sessionId: 1 });
submissionSchema.index({ survey_answered_by: 1 });
submissionSchema.index({ survey_created_by: 1, createdAt: -1 });

// Virtual to unify formId and survey_id
submissionSchema.virtual('unifiedFormId').get(function() {
  return this.formId || this.survey_id;
});

// Virtual to unify data and submissions
submissionSchema.virtual('unifiedData').get(function() {
  if (this.data) {
    return this.data instanceof Map ? Object.fromEntries(this.data) : this.data;
  }
  return this.submissions;
});

// Pre-save hook to sync formId and survey_id
submissionSchema.pre('save', function(next) {
  // Sync formId <-> survey_id
  if (this.formId && !this.survey_id) {
    this.survey_id = this.formId;
  } else if (this.survey_id && !this.formId) {
    this.formId = this.survey_id;
  }

  // Sync user_id if set
  if (this.survey_answered_by && !this.user_id) {
    this.user_id = this.survey_answered_by;
  }

  next();
});

// Update form/survey analytics after submission
submissionSchema.post('save', async function(doc) {
  try {
    const Survey = mongoose.model('Survey');
    const targetId = doc.formId || doc.survey_id;

    if (targetId) {
      await Survey.findByIdAndUpdate(
        targetId,
        {
          $inc: { 'analytics.total_submissions': 1 },
          $set: { 'analytics.last_submission_at': new Date() }
        }
      );
    }
  } catch (error) {
    console.error('Error updating survey analytics:', error);
  }
});

const Submission = mongoose.model('Submission', submissionSchema);

module.exports = Submission;
