import mongoose from 'mongoose';

const fileUploadSchema = new mongoose.Schema({
  originalName: {
    type: String,
    required: true,
    trim: true
  },
  fileName: {
    type: String,
    required: true,
    unique: true
  },
  mimeType: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  path: {
    type: String,
    required: true
  },

  // File metadata
  encoding: String,
  fieldName: String, // Form field that uploaded this file

  // Associated form and submission
  formId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Form'
  },
  submissionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Submission'
  },

  // File status
  status: {
    type: String,
    enum: ['uploading', 'completed', 'failed', 'deleted'],
    default: 'completed'
  },

  // File processing (for images)
  isProcessed: {
    type: Boolean,
    default: false
  },
  thumbnailPath: String,

  // Access control
  isPublic: {
    type: Boolean,
    default: false
  },
  downloadCount: {
    type: Number,
    default: 0
  },

  // File validation
  virusScanResult: {
    type: String,
    enum: ['pending', 'clean', 'infected', 'error'],
    default: 'pending'
  },

  // Expiration (for temporary files)
  expiresAt: Date,

  // Future user association
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Indexes for better query performance
fileUploadSchema.index({ fileName: 1 });
fileUploadSchema.index({ formId: 1, createdAt: -1 });
fileUploadSchema.index({ submissionId: 1 });
fileUploadSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// File size validation
fileUploadSchema.pre('save', function(next) {
  const maxFileSize = 10 * 1024 * 1024; // 10MB
  if (this.size > maxFileSize) {
    return next(new Error('File size exceeds maximum limit of 10MB'));
  }
  next();
});

// Increment download count
fileUploadSchema.methods.incrementDownload = function() {
  this.downloadCount += 1;
  return this.save();
};

// Get file URL (for future cloud storage integration)
fileUploadSchema.methods.getUrl = function() {
  if (this.isPublic) {
    return `/api/files/${this.fileName}`;
  }
  return `/api/files/private/${this.fileName}`;
};

// Generate thumbnail path for images
fileUploadSchema.methods.generateThumbnail = function() {
  if (this.mimeType.startsWith('image/')) {
    const pathParts = this.path.split('.');
    const extension = pathParts.pop();
    const basePath = pathParts.join('.');
    this.thumbnailPath = `${basePath}_thumb.${extension}`;
  }
};

const FileUpload = mongoose.model('FileUpload', fileUploadSchema);

export default FileUpload;