const mongoose = require("mongoose");

// BetterAuth Verification Schema
const verificationSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true
  },
  identifier: {
    type: String,
    required: true
  },
  value: {
    type: String,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  type: {
    type: String,
    enum: ['email_verification', 'magic_link', 'otp', 'password_reset'],
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'verification'
});

// Index for cleanup of expired tokens
verificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// BetterAuth Rate Limit Schema
const rateLimitSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true
  },
  count: {
    type: Number,
    default: 1
  },
  expiresAt: {
    type: Date,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'rateLimit'
});

// Auto-expire rate limit documents
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Passkey Credential Schema (separate from User for BetterAuth compatibility)
const passkeyCredentialSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  publicKey: {
    type: Buffer,
    required: true
  },
  counter: {
    type: Number,
    required: true,
    default: 0
  },
  credentialID: {
    type: Buffer,
    required: true
  },
  transports: [{
    type: String,
    enum: ['ble', 'hybrid', 'internal', 'nfc', 'usb']
  }],
  backupEligible: {
    type: Boolean,
    default: false
  },
  backupStatus: {
    type: Boolean,
    default: false
  },
  attestationObject: Buffer,
  clientDataJSON: Buffer,
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastUsed: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'passkeyCredential'
});

// Magic Link Token Schema
const magicLinkSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true
  },
  token: {
    type: String,
    required: true,
    unique: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  used: {
    type: Boolean,
    default: false
  },
  ipAddress: String,
  userAgent: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'magicLink'
});

// Auto-expire magic link documents
magicLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// OTP Schema
const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true
  },
  otp: {
    type: String,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  attempts: {
    type: Number,
    default: 0,
    max: 5
  },
  used: {
    type: Boolean,
    default: false
  },
  type: {
    type: String,
    enum: ['sign_in', 'verification', 'password_reset'],
    default: 'sign_in'
  },
  ipAddress: String,
  userAgent: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'otp'
});

// Auto-expire OTP documents and ensure unique active OTP per email
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpSchema.index({ email: 1, used: 1, expiresAt: 1 });

verificationSchema.index({ identifier: 1, type: 1 });
passkeyCredentialSchema.index({ user_id: 1 });
magicLinkSchema.index({ email: 1, used: 1 });
otpSchema.index({ email: 1, used: 1 });

// Create models
const Verification = mongoose.model("Verification", verificationSchema);
const RateLimit = mongoose.model("RateLimit", rateLimitSchema);
const PasskeyCredential = mongoose.model("PasskeyCredential", passkeyCredentialSchema);
const MagicLink = mongoose.model("MagicLink", magicLinkSchema);
const OTP = mongoose.model("OTP", otpSchema);

module.exports = {
  Verification,
  RateLimit,
  PasskeyCredential,
  MagicLink,
  OTP
};