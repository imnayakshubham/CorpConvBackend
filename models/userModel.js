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
  isAdmin: {
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
  providerId: {
    type: String,
    required: true,
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
  firebaseUid: {
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
  credentials: [CredentialSchema],

  // BetterAuth compatibility fields
  betterAuthId: {
    type: String,
    sparse: true,
    unique: true,
    default: null
  },
  emailVerified: {
    type: Date,
    default: null
  },
  image: {
    type: String,
    default: null
  },

  // Password hash for BetterAuth email/password auth
  hashedPassword: {
    type: String,
    default: null
  },

  // Magic link and OTP tracking
  verificationTokens: [{
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
  accounts: [{
    provider: String,
    providerId: String,
    accessToken: String,
    refreshToken: String,
    expiresAt: Date
  }],

  // Passkey credentials for WebAuthn
  passkeyCredentials: [{
    id: String,
    publicKey: Buffer,
    counter: Number,
    transports: [String],
    createdAt: {
      type: Date,
      default: Date.now
    },
    lastUsed: Date,
    nickname: String
  }],

  // Authentication method preferences
  authMethods: {
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
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  backupCodes: [{
    code: String,
    used: {
      type: Boolean,
      default: false
    }
  }]
}, { timestaps: true });




userSchema.index({ hobbies: 1 });
userSchema.index({ profession: 1, field_of_study: 1, last_active_at: -1 });


const User = mongoose.model("User", userSchema);

module.exports = User;
