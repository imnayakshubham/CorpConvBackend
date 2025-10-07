const mongoose = require("mongoose");

const avatarSchema = new mongoose.Schema({
  style: {
    type: String,
    required: [true, "Avatar style is required"],
    trim: true
  },
  gender: {
    type: String,
    enum: ["male", "female", "unisex", "neutral"],
    required: [true, "Avatar gender is required"]
  },
  seed: {
    type: String,
    required: [true, "Avatar seed is required"]
  },
  skinColor: {
    type: String,
    required: [true, "Avatar skinColor is required"]
  },
  hairStyle: {
    type: String,
    required: [true, "Avatar hairStyle is required"]
  },
  accessories: {
    type: [String],
    validate: {
      validator: arr => Array.isArray(arr),
      message: "Accessories must be an array of strings"
    },
    default: []
  }
}, { _id: false });

const CredentialSchema = new mongoose.Schema({
  credentialID: { type: String, required: true },
  publicKey: { type: Buffer, required: true },
  counter: { type: Number, required: true },
  transports: [{ type: String }],
  nickname: { type: String, default: '', trim: true }, // Device label
}, { timestaps: true });

const userSchema = mongoose.Schema({
  actual_user_name: {
    type: String,
    default: null,
    required: [true, "User Name is required"],
  },
  public_user_name: {
    type: String,
    default: null
  },
  is_email_verified: {
    type: Boolean,
    default: false,
    required: [true, "is_email_verified is required"],
  },
  user_location: {
    type: String,
    default: null
  },
  user_job_role: {
    type: String,
    default: null
  },
  user_job_experience: {
    type: Number,
    default: null
  },
  user_bio: {
    type: String,
    default: null
  },
  is_admin: {
    type: Boolean,
    required: true,
    default: false,
  },
  actual_profile_pic: {
    type: String,
    required: false,
    default: "https://icon-library.com/images/anonymous-avatar-icon/anonymous-avatar-icon-25.jpg",
  },
  user_public_profile_pic: {
    type: String,
    required: true,
    default: "https://icon-library.com/images/anonymous-avatar-icon/anonymous-avatar-icon-25.jpg",
  },
  provider: {
    type: String,
    required: true,
  },
  provider_id: {
    type: String,
    required: false,
    default: null
  },
  user_phone_number: {
    type: Number,
    required: false,
    default: null
  },
  is_anonymous: {
    type: Boolean,
    default: false,
  },
  user_email_id: {
    type: String,
    trim: true,
    unique: true,
    required: [true, "Email is required"],
  },
  firebase_uid: {
    type: String,
    trim: true,
    sparse: true, // Allows multiple null values
    unique: true, // But unique when not null
    default: null
  },
  is_email_verified: {
    type: Boolean,
    default: false,
    required: [true, "Email Verfication key is required"],
  },
  access: { type: Boolean, required: true, default: true },
  meta_data: {
    type: Object,
    default: {}
  },
  user_current_company_name: {
    type: String,
    trim: true,
    required: [true, "User Company Name is required"],
  },
  user_company_id: {
    type: String,
    trim: true,
    required: [true, "User Company Id is required"],
  },
  user_past_company_history: {
    type: Object,
    default: []
  },
  token: {
    default: null,
    type: String,
  },
  followers: [{
    type: String,
    ref: 'User',
    default: [],
  }],
  followings: [{
    type: String,
    ref: 'User',
    default: [],
  }],
  pending_followings: [{
    type: String,
    ref: 'User',
    default: []
  }],
  secondary_email_id: {
    type: String,
    trim: true,
    lowercase: true,
    default: null,
  },
  is_secondary_email_id_verified: {
    default: false,
    type: Boolean,
  },
  primary_email_domain: {
    type: String,
    required: true,
    trim: true,
  },
  secondary_email_domain: {
    type: String,
    trim: true,
  },
  avatar: {
    type: avatarSchema,
    required: false
  },
  academic_level: {
    type: String,
    default: null
  },

  field_of_study: {
    type: String,
    default: null
  },

  hobbies: {
    type: [{ type: String, trim: true }],
    validate: {
      validator: arr => Array.isArray(arr) && arr.length <= 10,
      message: "Maximum 10 hobbies allowed"
    },
    default: []
  },
  gender: {
    type: String,
    enum: ["male", "female", "prefer-not-to-say"],
    required: false,
    default: "prefer-not-to-say"
  },

  profession: {
    type: String,
    enum: ["student", "employed", "self-employed", "unemployed", "retired", "homemaker", "other"],
    required: true,
    default: null
  },
  profile_details: {
    type: mongoose.Schema.Types.ObjectId, ref: 'ProfileDetails'
  },
  embedding: { type: [Number], default: null }, // array of floats
  embedding_updated_at: Date,
  last_active_at: { type: Date, default: Date.now },

  // Legacy credentials (deprecated - use Better-auth PasskeyCredential model instead)
  credentials: [CredentialSchema],

  // BetterAuth compatibility fields
  better_auth_id: {
    type: String,
    sparse: true,
    unique: true,
    default: null
  },
  email_verified_at: {
    type: Date,
    default: null
  },
  user_image: {
    type: String,
    default: null
  },

  // Password hash for BetterAuth email/password auth
  hashed_password: {
    type: String,
    default: null
  },

  // Magic link and OTP tracking
  verification_tokens: [{
    token: String,
    type: {
      type: String,
      enum: ['email_verification', 'magic_link', 'otp', 'password_reset']
    },
    expires: Date,
    used: {
      type: Boolean,
      default: false
    }
  }],

  // Social auth providers
  auth_accounts: [{
    provider: String,
    provider_id: String,
    access_token: String,
    refresh_token: String,
    expires_at: Date
  }],

  // Passkey credentials for WebAuthn (deprecated - use Better-auth PasskeyCredential model instead)
  // Better-auth stores passkeys in separate 'passkeyCredential' collection
  passkey_credentials: [{
    public_key: Buffer,
    counter: Number,
    transports: [String],
    created_at: {
      type: Date,
      default: Date.now
    },
    last_used: Date,
    nickname: String
  }],

  // Authentication method preferences
  auth_methods: {
    email: {
      type: Boolean,
      default: true
    },
    google: {
      type: Boolean,
      default: true
    },
    passkey: {
      type: Boolean,
      default: false
    }
  },

  // Security settings
  two_factor_enabled: {
    type: Boolean,
    default: false
  },
  backup_codes: [{
    code: String,
    used: {
      type: Boolean,
      default: false
    }
  }],

  // Encryption flag - indicates if sensitive data is encrypted
  is_masked: {
    type: Boolean,
    default: false,
    required: true,
    index: true  // For querying encrypted vs plain users
  },

  // Premium subscription fields
  has_premium: {
    type: Boolean,
    default: false,
    required: true,
    index: true  // For querying premium users
  },
  premium_expires_at: {
    type: Date,
    default: null  // null means no expiration (lifetime) or not premium
  },
  premium_plan: {
    type: String,
    enum: ["free", "monthly", "yearly", "lifetime"],
    default: "free",
    required: true
  }
}, { timestaps: true });




userSchema.index({ hobbies: 1 });
userSchema.index({ profession: 1, field_of_study: 1, last_active_at: -1 });

// Encryption middleware - auto-encrypt sensitive fields before saving
userSchema.pre('save', async function (next) {
  // Skip if already masked and no sensitive fields modified
  if (this.is_masked &&
    !this.isModified('user_email_id') &&
    !this.isModified('actual_user_name') &&
    !this.isModified('user_phone_number') &&
    !this.isModified('secondary_email_id') &&
    !this.isModified('user_location')) {
    return next();
  }

  // Check if encryption is configured
  if (!process.env.ENCRYPTION_KEY) {
    console.warn('⚠️  ENCRYPTION_KEY not configured - data will not be encrypted');
    this.is_masked = false;
    return next();
  }

  // Encrypt sensitive fields
  const { encrypt } = require('../utils/encryption');

  const fieldsToEncrypt = [
    'user_email_id',
    'actual_user_name',
    'user_phone_number',
    'secondary_email_id',
    'user_location'
  ];

  let encryptionSucceeded = true;

  for (const field of fieldsToEncrypt) {
    if (this[field] && this.isModified(field)) {
      // Only encrypt if not already encrypted (doesn't contain ':' or not in format)
      const value = String(this[field]);
      const parts = value.split(':');

      // Check if already encrypted (format: iv:authTag:encrypted)
      if (parts.length !== 3 || !/^[0-9a-f]+$/.test(parts[0])) {
        try {
          const encrypted = encrypt(value);

          // Verify encryption actually happened (not plain text fallback)
          if (!encrypted || encrypted === value || !encrypted.includes(':')) {
            console.error(`❌ Encryption failed for field: ${field}`);
            encryptionSucceeded = false;
            break;
          }

          this[field] = encrypted;
        } catch (error) {
          console.error(`❌ Encryption error for field ${field}:`, error);
          encryptionSucceeded = false;
          break;
        }
      }
    }
  }

  // Only set is_masked if encryption succeeded for all fields
  this.is_masked = encryptionSucceeded;

  if (!encryptionSucceeded) {
    console.warn('⚠️  User data saved without encryption due to errors');
  }

  next();
});

// Virtual method to get decrypted user data (backward compatible)
// This automatically handles both encrypted and plain text data
userSchema.methods.getDecryptedData = function() {
  const { getSafeUserData } = require('../utils/encryption');
  return getSafeUserData(this);
};

// Helper method to check if user's sensitive data is properly encrypted
userSchema.methods.isDataEncrypted = function() {
  const { isEncrypted } = require('../utils/encryption');

  const sensitiveFields = [
    'user_email_id',
    'actual_user_name',
    'user_phone_number',
    'secondary_email_id',
    'user_location'
  ];

  // Check if all non-null sensitive fields are encrypted
  const results = sensitiveFields
    .filter(field => this[field]) // Only check fields that have values
    .map(field => ({
      field,
      encrypted: isEncrypted(this[field])
    }));

  const allEncrypted = results.every(r => r.encrypted);
  const someEncrypted = results.some(r => r.encrypted);

  return {
    allEncrypted,
    someEncrypted,
    mixedState: someEncrypted && !allEncrypted,
    details: results
  };
};

const User = mongoose.model("User", userSchema);

module.exports = User;
