import mongoose from 'mongoose';

const analyticsEventSchema = new mongoose.Schema({
  formId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Form',
    required: true
  },

  eventType: {
    type: String,
    enum: [
      'view',           // Form page viewed
      'field_focus',    // User focused on a field
      'field_blur',     // User left a field
      'field_change',   // Field value changed
      'submit',         // Form submitted
      'submit_success', // Form submitted successfully
      'submit_error',   // Form submission failed
      'validation_error', // Field validation failed
      'file_upload',    // File uploaded
      'page_exit'       // User left the form page
    ],
    required: true
  },

  // Field-specific events
  fieldId: String,
  fieldType: String,

  // Event data
  data: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  },

  // Session and user tracking
  sessionId: {
    type: String,
    required: true
  },

  // Geographic and technical info
  ipAddress: {
    type: String,
    select: false // Privacy - don't include in queries by default
  },
  userAgent: {
    type: String,
    select: false
  },
  referrer: String,

  // Device info
  deviceInfo: {
    isMobile: Boolean,
    isTablet: Boolean,
    isDesktop: Boolean,
    browser: String,
    os: String,
    screenResolution: String
  },

  // Form interaction metrics
  timeOnField: Number, // Time spent on field (milliseconds)
  scrollDepth: Number, // How far user scrolled (percentage)

  // A/B testing (future feature)
  variant: String,

  // Event timestamp
  timestamp: {
    type: Date,
    default: Date.now
  },

  // User ID for authenticated users (future)
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Indexes for analytics queries
analyticsEventSchema.index({ formId: 1, eventType: 1, timestamp: -1 });
analyticsEventSchema.index({ sessionId: 1, timestamp: 1 });
analyticsEventSchema.index({ formId: 1, timestamp: -1 });
analyticsEventSchema.index({ eventType: 1, timestamp: -1 });

// Update form view count for view events
analyticsEventSchema.post('save', async function(doc) {
  if (doc.eventType === 'view') {
    try {
      const Form = mongoose.model('Form');
      await Form.findByIdAndUpdate(
        doc.formId,
        { $inc: { 'analytics.totalViews': 1 } }
      );
    } catch (error) {
      console.error('Error updating form view count:', error);
    }
  }
});

// Static methods for analytics aggregation
analyticsEventSchema.statics.getFormAnalytics = function(formId, startDate, endDate) {
  const match = {
    formId: new mongoose.Types.ObjectId(formId),
    timestamp: {
      $gte: startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Default 30 days
      $lte: endDate || new Date()
    }
  };

  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$eventType',
        count: { $sum: 1 },
        uniqueSessions: { $addToSet: '$sessionId' }
      }
    },
    {
      $project: {
        eventType: '$_id',
        count: 1,
        uniqueUsers: { $size: '$uniqueSessions' }
      }
    }
  ]);
};

analyticsEventSchema.statics.getFieldAnalytics = function(formId, fieldId) {
  return this.aggregate([
    {
      $match: {
        formId: new mongoose.Types.ObjectId(formId),
        fieldId: fieldId,
        eventType: { $in: ['field_focus', 'field_blur', 'field_change', 'validation_error'] }
      }
    },
    {
      $group: {
        _id: '$eventType',
        count: { $sum: 1 },
        avgTimeOnField: { $avg: '$timeOnField' }
      }
    }
  ]);
};

const AnalyticsEvent = mongoose.model('AnalyticsEvent', analyticsEventSchema);

export default AnalyticsEvent;