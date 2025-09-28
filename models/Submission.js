import mongoose from 'mongoose';

const attachmentSchema = new mongoose.Schema({
  fieldId: {
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
  formId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Form',
    required: true
  },

  // Response data - flexible structure to handle any form fields
  data: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    required: true
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

  // Future user association
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Spam detection
  isSpam: {
    type: Boolean,
    default: false
  },
  spamScore: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Indexes for better query performance
submissionSchema.index({ formId: 1, submittedAt: -1 });
submissionSchema.index({ formId: 1, isSpam: 1 });
submissionSchema.index({ sessionId: 1 });

// Update form analytics after submission
submissionSchema.post('save', async function(doc) {
  try {
    const Form = mongoose.model('Form');
    await Form.findByIdAndUpdate(
      doc.formId,
      {
        $inc: { 'analytics.totalSubmissions': 1 },
        $set: { 'analytics.lastSubmissionAt': new Date() }
      }
    );
  } catch (error) {
    console.error('Error updating form analytics:', error);
  }
});

const Submission = mongoose.model('Submission', submissionSchema);

export default Submission;