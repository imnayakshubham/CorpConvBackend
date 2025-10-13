import mongoose from 'mongoose';

const conditionalLogicSchema = new mongoose.Schema({
  field_id: {
    type: String,
    required: true
  },
  condition: {
    field_id: {
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
  min_length: Number,
  max_length: Number,
  pattern: String,
  custom_message: String,
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
  conditional_logic: {
    show_if: [conditionalLogicSchema]
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
  allow_multiple_submissions: {
    type: Boolean,
    default: true
  },
  require_authentication: {
    type: Boolean,
    default: false
  },
  submit_button_text: {
    type: String,
    default: 'Submit'
  },
  successMessage: {
    type: String,
    default: 'Thank you for your submission!'
  },
  redirect_url: String,
  collectEmail: {
    type: Boolean,
    default: false
  },
  is_public: {
    type: Boolean,
    default: true
  }
});

const formThemeSchema = new mongoose.Schema({
  primary_color: {
    type: String,
    default: '#3b82f6'
  },
  background_color: {
    type: String,
    default: '#ffffff'
  },
  font_family: {
    type: String,
    default: 'Inter'
  },
  border_radius: {
    type: String,
    default: '8px'
  },
  custom_css: String
});

const formAnalyticsSchema = new mongoose.Schema({
  total_views: {
    type: Number,
    default: 0
  },
  total_submissions: {
    type: Number,
    default: 0
  },
  conversion_rate: {
    type: Number,
    default: 0
  },
  last_submission_at: Date
});

const formSchema = new mongoose.Schema({
  survey_title: {
    type: String,
    required: true,
    trim: true
  },
  survey_description: {
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
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Create unique slug before saving
formSchema.pre('save', function (next) {
  if (!this.slug && this.survey_title) {
    const baseSlug = this.survey_title
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    this.slug = `${baseSlug}-${Date.now()}`;
  }
  next();
});

// Update conversion rate when analytics change
formSchema.pre('save', function (next) {
  if (this.analytics.total_views > 0) {
    this.analytics.conversion_rate = (this.analytics.total_submissions / this.analytics.total_views) * 100;
  }
  next();
});

// Indexes for better query performance
formSchema.index({ status: 1, createdAt: -1 });
formSchema.index({ slug: 1 });
formSchema.index({ user_id: 1 });

const Form = mongoose.model('Form', formSchema);

export default Form;