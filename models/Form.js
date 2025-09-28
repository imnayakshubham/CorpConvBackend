import mongoose from 'mongoose';

const conditionalLogicSchema = new mongoose.Schema({
  fieldId: {
    type: String,
    required: true
  },
  condition: {
    fieldId: {
      type: String,
      required: true
    },
    operator: {
      type: String,
      enum: ['equals', 'contains', 'greater_than', 'less_than', 'not_equals'],
      required: true
    },
    value: mongoose.Schema.Types.Mixed
  },
  action: {
    type: String,
    enum: ['show', 'hide', 'require', 'disable'],
    required: true
  }
});

const fieldValidationSchema = new mongoose.Schema({
  minLength: Number,
  maxLength: Number,
  pattern: String,
  customMessage: String,
  required: {
    type: Boolean,
    default: false
  }
});

const formFieldSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['text', 'email', 'number', 'select', 'checkbox', 'radio', 'textarea', 'file', 'date', 'phone', 'url'],
    required: true
  },
  label: {
    type: String,
    required: true
  },
  placeholder: String,
  required: {
    type: Boolean,
    default: false
  },
  position: {
    x: {
      type: Number,
      default: 0
    },
    y: {
      type: Number,
      default: 0
    }
  },
  // Field-specific properties
  options: [String], // for select/radio/checkbox
  validation: fieldValidationSchema,

  // Conditional logic
  conditionalLogic: {
    showIf: [conditionalLogicSchema]
  },

  // Styling
  styling: {
    width: {
      type: String,
      default: 'full'
    },
    className: String
  }
});

const formSettingsSchema = new mongoose.Schema({
  allowMultipleSubmissions: {
    type: Boolean,
    default: true
  },
  requireAuthentication: {
    type: Boolean,
    default: false
  },
  submitButtonText: {
    type: String,
    default: 'Submit'
  },
  successMessage: {
    type: String,
    default: 'Thank you for your submission!'
  },
  redirectUrl: String,
  collectEmail: {
    type: Boolean,
    default: false
  },
  isPublic: {
    type: Boolean,
    default: true
  }
});

const formThemeSchema = new mongoose.Schema({
  primaryColor: {
    type: String,
    default: '#3b82f6'
  },
  backgroundColor: {
    type: String,
    default: '#ffffff'
  },
  fontFamily: {
    type: String,
    default: 'Inter'
  },
  borderRadius: {
    type: String,
    default: '8px'
  },
  customCSS: String
});

const formAnalyticsSchema = new mongoose.Schema({
  totalViews: {
    type: Number,
    default: 0
  },
  totalSubmissions: {
    type: Number,
    default: 0
  },
  conversionRate: {
    type: Number,
    default: 0
  },
  lastSubmissionAt: Date
});

const formSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'archived'],
    default: 'draft'
  },

  // Form Structure
  fields: [formFieldSchema],
  logic: [conditionalLogicSchema],

  // Settings
  settings: {
    type: formSettingsSchema,
    default: () => ({})
  },

  // Styling
  theme: {
    type: formThemeSchema,
    default: () => ({})
  },

  // Analytics
  analytics: {
    type: formAnalyticsSchema,
    default: () => ({})
  },

  // Metadata
  slug: {
    type: String,
    unique: true,
    sparse: true
  },

  // Future auth integration
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Create unique slug before saving
formSchema.pre('save', function(next) {
  if (!this.slug && this.title) {
    const baseSlug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    this.slug = `${baseSlug}-${Date.now()}`;
  }
  next();
});

// Update conversion rate when analytics change
formSchema.pre('save', function(next) {
  if (this.analytics.totalViews > 0) {
    this.analytics.conversionRate = (this.analytics.totalSubmissions / this.analytics.totalViews) * 100;
  }
  next();
});

// Indexes for better query performance
formSchema.index({ status: 1, createdAt: -1 });
formSchema.index({ slug: 1 });
formSchema.index({ userId: 1 });

const Form = mongoose.model('Form', formSchema);

export default Form;