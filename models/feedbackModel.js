const mongoose = require("mongoose");

const userContextSchema = new mongoose.Schema({
  page: {
    type: String,
    required: [true, "Page URL is required"],
    trim: true
  },
  userAgent: {
    type: String,
    required: [true, "User agent is required"],
    trim: true
  },
  timestamp: {
    type: Date,
    required: [true, "Timestamp is required"],
    default: Date.now
  },
  errorDetails: {
    message: String,
    stack: String,
    componentStack: String,
    errorBoundary: String
  },
  viewport: {
    width: Number,
    height: Number
  },
  browserInfo: {
    language: String,
    platform: String,
    cookieEnabled: Boolean,
    onlineStatus: Boolean
  }
}, { _id: false });

const feedbackSchema = mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null // Allows anonymous feedback
  },
  type: {
    type: String,
    required: [true, "Feedback type is required"],
    enum: {
      values: ["bug", "feature", "general", "ui_ux", "performance", "content"],
      message: "Feedback type must be one of: bug, feature, general, ui_ux, performance, content"
    },
    index: true
  },
  priority: {
    type: String,
    required: [true, "Priority is required"],
    enum: {
      values: ["low", "medium", "high", "critical"],
      message: "Priority must be one of: low, medium, high, critical"
    },
    default: "medium",
    index: true
  },
  title: {
    type: String,
    required: [true, "Title is required"],
    trim: true,
    maxlength: [200, "Title cannot exceed 200 characters"],
    minlength: [5, "Title must be at least 5 characters long"]
  },
  description: {
    type: String,
    required: [true, "Description is required"],
    trim: true,
    maxlength: [2000, "Description cannot exceed 2000 characters"],
    minlength: [10, "Description must be at least 10 characters long"]
  },
  userContext: {
    type: userContextSchema,
    required: [true, "User context is required"]
  },
  attachments: [{
    filename: {
      type: String,
      required: [true, "Attachment filename is required"]
    },
    url: {
      type: String,
      required: [true, "Attachment URL is required"]
    },
    size: {
      type: Number,
      required: [true, "Attachment size is required"]
    },
    mimeType: {
      type: String,
      required: [true, "Attachment MIME type is required"]
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  status: {
    type: String,
    required: [true, "Status is required"],
    enum: {
      values: ["new", "reviewing", "in_progress", "resolved", "closed", "duplicate"],
      message: "Status must be one of: new, reviewing, in_progress, resolved, closed, duplicate"
    },
    default: "new",
    index: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },
  adminNotes: [{
    note: {
      type: String,
      required: [true, "Admin note text is required"],
      trim: true,
      maxlength: [1000, "Admin note cannot exceed 1000 characters"]
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Admin note author is required"]
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
    maxlength: [30, "Tag cannot exceed 30 characters"]
  }],
  resolution: {
    type: String,
    trim: true,
    maxlength: [1000, "Resolution cannot exceed 1000 characters"]
  },
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },
  resolvedAt: {
    type: Date,
    default: null
  },
  upvotes: {
    type: Number,
    default: 0,
    min: [0, "Upvotes cannot be negative"]
  },
  upvotedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }],
  isPublic: {
    type: Boolean,
    default: false // Whether feedback is visible to other users
  },
  source: {
    type: String,
    enum: ["manual", "error_boundary", "api", "widget"],
    default: "manual",
    index: true
  },
  ipAddress: {
    type: String,
    trim: true
  },
  sessionId: {
    type: String,
    trim: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
feedbackSchema.index({ type: 1, status: 1 });
feedbackSchema.index({ priority: 1, createdAt: -1 });
feedbackSchema.index({ userId: 1, createdAt: -1 });
feedbackSchema.index({ assignedTo: 1, status: 1 });
feedbackSchema.index({ source: 1, createdAt: -1 });

// Virtual for feedback age
feedbackSchema.virtual('age').get(function() {
  return Date.now() - this.createdAt.getTime();
});

// Virtual for response time (if resolved)
feedbackSchema.virtual('responseTime').get(function() {
  if (this.resolvedAt) {
    return this.resolvedAt.getTime() - this.createdAt.getTime();
  }
  return null;
});

// Pre-save middleware to auto-generate title if not provided
feedbackSchema.pre('save', function(next) {
  if (!this.title && this.description) {
    // Generate title from first 50 characters of description
    this.title = this.description.substring(0, 50).trim();
    if (this.description.length > 50) {
      this.title += '...';
    }
  }

  // Set resolved timestamp when status changes to resolved
  if (this.isModified('status') && this.status === 'resolved' && !this.resolvedAt) {
    this.resolvedAt = new Date();
  }

  next();
});

// Instance method to add admin note
feedbackSchema.methods.addAdminNote = function(note, adminId) {
  this.adminNotes.push({
    note: note,
    addedBy: adminId,
    addedAt: new Date()
  });
  return this.save();
};

// Instance method to resolve feedback
feedbackSchema.methods.resolve = function(resolution, resolvedBy) {
  this.status = 'resolved';
  this.resolution = resolution;
  this.resolvedBy = resolvedBy;
  this.resolvedAt = new Date();
  return this.save();
};

// Instance method to add upvote
feedbackSchema.methods.addUpvote = function(userId) {
  if (!this.upvotedBy.includes(userId)) {
    this.upvotedBy.push(userId);
    this.upvotes += 1;
    return this.save();
  }
  return Promise.resolve(this);
};

// Instance method to remove upvote
feedbackSchema.methods.removeUpvote = function(userId) {
  const index = this.upvotedBy.indexOf(userId);
  if (index > -1) {
    this.upvotedBy.splice(index, 1);
    this.upvotes -= 1;
    return this.save();
  }
  return Promise.resolve(this);
};

// Static method to get feedback statistics
feedbackSchema.statics.getStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: null,
        totalFeedback: { $sum: 1 },
        byType: {
          $push: {
            type: "$type",
            count: 1
          }
        },
        byStatus: {
          $push: {
            status: "$status",
            count: 1
          }
        },
        avgResponseTime: {
          $avg: {
            $cond: {
              if: { $ne: ["$resolvedAt", null] },
              then: { $subtract: ["$resolvedAt", "$createdAt"] },
              else: null
            }
          }
        }
      }
    }
  ]);
};

// Static method to get trending feedback
feedbackSchema.statics.getTrending = function(limit = 10) {
  return this.find({ isPublic: true })
    .sort({ upvotes: -1, createdAt: -1 })
    .limit(limit)
    .populate('userId', 'actual_user_name public_user_name')
    .lean();
};

const Feedback = mongoose.model("Feedback", feedbackSchema);

module.exports = Feedback;