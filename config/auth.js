const { betterAuth } = require("better-auth");
const { mongodbAdapter } = require("better-auth/adapters/mongodb");
const { passkey } = require("better-auth/plugins/passkey");
const { customSession, admin, organizationRoleSchema, organization } = require("better-auth/plugins");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const logger = require("../utils/logger");
const emailService = require("../services/emailService");
const { betterAuthSessionCookie, projection } = require("../constants");
const { User } = require("../models/userModel");
const { getOrAddDataInRedis } = require("../redisClient/redisUtils");
const { decryptUserData } = require("../utils/encryption");
const Company = require("../models/companySchema");
const { toTitleCase } = require("../utils/utils");


// Generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() + 900000).toString();
};

// Store OTP in Redis or memory (for production use Redis)
const otpStore = new Map();

// Validate and provide fallback for baseURL
const baseURL = process.env.BETTER_AUTH_URL || process.env.ALLOW_ORIGIN?.split(',')[0] || "http://localhost:5000";
if (!process.env.BETTER_AUTH_URL && !process.env.ALLOW_ORIGIN) {
  logger.warn(`BETTER_AUTH_URL not configured - using fallback: ${baseURL}`);
}

const allowedOrgins = process.env.ALLOW_ORIGIN ? process.env.ALLOW_ORIGIN.split(",").map(o => o.trim()) : []

// Factory function to create auth instance after DB connection
const createAuth = () => {
  // Ensure mongoose is connected
  if (!mongoose.connection.db) {
    throw new Error("MongoDB must be connected before initializing better-auth");
  }

  return betterAuth({
    database: mongodbAdapter(mongoose.connection.db),

    secret: process.env.BETTER_AUTH_SECRET || process.env.JWT_SECRET_KEY,
    baseURL,
    appName: "hushwork",
    user: {
      modelName: "users",

      fields: {
        userId: "_id",
        email: "user_email_id",
        username: "actual_user_name",
        name: "actual_user_name",
        phone: "user_phone_number",
        image: "actual_profile_pic"
      },
      additionalFields: {
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
          default: null
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
          type: User.avatarSchemaConfig,
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
          default: null
        },
        profile_details: {
          type: mongoose.Schema.Types.ObjectId, ref: 'ProfileDetails'
        },
        embedding: { type: [Number], default: null }, // array of floats
        embedding_updated_at: Date,
        last_active_at: { type: Date, default: Date.now },

        // Legacy credentials (deprecated - use Better-auth PasskeyCredential model instead)
        credentials: [User.credentialSchemaConfig],


        email_verified_at: {
          type: Date,
          default: null
        },
        user_image: {
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
      }
    },

    advanced: {
      cookies: {

        session_token: {

          attributes: {
            httpOnly: true,
            secure: process.env.APP_ENV === 'PROD',
            sameSite: process.env.APP_ENV === 'PROD' ? 'none' : 'lax',
            maxAge: 60 * 60 * 24 * 7 * 1000, // 7 days in ms
            path: '/',
          }
        },
        crossSubDomainCookies: {
          enabled: true,
          domain: process.env.FRONTEND_URL, // your domain
        },
        trustedOrigins: process.env.ALLOW_ORIGIN ? process.env.ALLOW_ORIGIN.split(",").map(o => o.trim()) : [],
      },
    },


    // Social providers
    socialProviders: {
      google: {
        clientId: process.env.CLIENT_ID,
        clientSecret: process.env.CLIENT_SECRET,
        prompt: "select_account",
        scope: ["openid", "email", "profile"],
      }
    },

    // Plugin configuration
    plugins: [
      // Passkey authentication
      passkey({
        rpName: process.env.APP_NAME || "Hushwork",
        rpID: process.env.APP_ENV === 'PROD'
          ? new URL(process.env.BETTER_AUTH_URL || '').hostname
          : "localhost",
        origin: allowedOrgins
      }),
      admin(),
      organization(),

      customSession(async ({ user, session }) => {
        const userInfo = await getOrAdduser(session.userId);
        return {
          user: {
            ...userInfo,
          },
          session
        };
      }),

    ],

    databaseHooks: {
      user: {
        create: {
          before: async (userData) => {
            const newUser = await createUser(userData)
            logger.info(`New user signup===>`, newUser);
            return newUser;
          }
        }
      },
      session: {
        create: {
          before: async (sessionData) => {
            logger.info(`New session created for user: `, sessionData);
            return sessionData
          }
        }
      }
    },

    // Rate limiting
    rateLimit: {
      window: 60, // 1 minute
      max: 10, // 10 requests per minute
      storage: "memory" // Use Redis in production
    },

    // Custom error handling
    onError: (error, request) => {
      logger.error("BetterAuth error:", error);
      return {
        message: "Authentication error occurred",
        status: error.status || 500
      };
    },

    // Custom success handling
    onSuccess: (context) => {
      logger.info(`Authentication success: ${context.user?.email || 'Unknown'}`);
    },
  });
};

// Singleton instance
let authInstance = null;

// Get or create auth instance
const getAuth = () => {
  if (!authInstance) {
    authInstance = createAuth();
  }
  return authInstance;
};

// Helper function to verify OTP manually
const verifyOTP = (email, otp) => {
  const stored = otpStore.get(email);

  if (!stored) {
    return { success: false, error: "OTP not found or expired" };
  }

  if (stored.expires < Date.now()) {
    otpStore.delete(email);
    return { success: false, error: "OTP expired" };
  }

  if (stored.otp !== otp) {
    return { success: false, error: "Invalid OTP" };
  }

  otpStore.delete(email);
  return { success: true };
};

// Helper function to generate magic link
const generateMagicLink = async (email) => {
  try {
    // Generate a secure token
    const token = require('crypto').randomBytes(32).toString('hex');

    // Store token with expiration (use Redis in production)
    otpStore.set(`magic_${email}`, {
      token,
      expires: Date.now() + (15 * 60 * 1000), // 15 minutes
      type: 'magic-link'
    });

    const baseUrl = process.env.BETTER_AUTH_URL || process.env.ALLOW_ORIGIN?.split(',')[0];
    const magicUrl = `${baseUrl}/verify?token=${token}&email=${encodeURIComponent(email)}`;
    console.log({ baseUrl, magicUrl })
    return { success: true, url: magicUrl, token };
  } catch (error) {
    logger.error("Failed to generate magic link:", error);
    return { success: false, error: "Failed to generate magic link" };
  }
};

// Helper function to verify magic link token
const verifyMagicToken = (email, token) => {
  const stored = otpStore.get(`magic_${email}`);

  if (!stored) {
    return { success: false, error: "Magic link not found or expired" };
  }

  if (stored.expires < Date.now()) {
    otpStore.delete(`magic_${email}`);
    return { success: false, error: "Magic link expired" };
  }

  if (stored.token !== token) {
    return { success: false, error: "Invalid magic link" };
  }

  otpStore.delete(`magic_${email}`);
  return { success: true };
};


const responseFormatterForAuth = (result) => {
  // For anonymous app - only send public, non-sensitive data to frontend
  // Sensitive data (email, actual name, phone) stays on backend only
  const decrypted = decryptUserData(result);

  return {
    // Core identity (non-sensitive)
    _id: decrypted._id,
    public_user_name: decrypted.public_user_name,  // Public display name only
    user_public_profile_pic: decrypted.user_public_profile_pic,
    is_anonymous: decrypted.is_anonymous,

    // Public profile information
    user_bio: decrypted.user_bio,
    user_job_role: decrypted.user_job_role,
    user_job_experience: decrypted.user_job_experience,
    user_current_company_name: decrypted.user_current_company_name,

    // Account status flags
    is_email_verified: decrypted.is_email_verified,
    isAdmin: decrypted.isAdmin,

    // Premium subscription
    has_premium: decrypted.has_premium || false,
    premium_expires_at: decrypted.premium_expires_at || null,
    premium_plan: decrypted.premium_plan || 'free'
  }
}

const createUser = async (userData) => {
  try {

    const emailSplit = userData.email.split("@")
    const domain = emailSplit[1].split(".")[0]
    const companyExist = await Company.findOne({ company_name: toTitleCase(domain) });
    const companyId = companyExist && companyExist?.company_id ? companyExist?.company_id : new mongoose.Types.ObjectId()
    const companyName = companyExist && companyExist?.company_name ? companyExist?.company_name : toTitleCase(domain)
    if (!companyExist) {
      const company = await new Company({
        company_id: companyId,
        company_name: companyName
      })
      await company.save()
    }
    const user_current_company_name = !["example", "gmail", "outlook"].includes(domain) ? toTitleCase(domain) : "Somewhere"
    const data = {
      ...userData,
      actual_user_name: userData?.name || `${userData?.given_name || ''} ${userData?.family_name || ''}`.trim(),
      user_email_id: userData?.email,
      actual_profile_pic: userData?.picture || userData?.photoURL || null,
      providerId: userData?.providerId || "google",
      meta_data: userData?.metadata || null,
      provider: userData?.providerId ?? "google",
      is_email_verified: !["example", "gmail", "outlook"].includes(domain) ? true : false,
      is_anonymous: true,
      user_current_company_name,
      user_phone_number: userData?.user_phone_number ? keepOnlyNumbers(userData?.user_phone_number) : null,
      user_company_id: companyId,
      user_past_company_history: [companyId],
      primary_email_domain: emailSplit[1],
    }
    const user = await new User(data);
    const result = await user.save();
    const userActualData = responseFormatterForAuth(result);
    // add to redis
    const userInfoRedisKey = `${process.env.APP_ENV}_user_info_${result._id}`
    await getOrAddDataInRedis(userInfoRedisKey, userActualData)
    return user;
  } catch (error) {
    logger.error("Error creating user:", error);
    throw error;
  }
}

const getOrAdduser = async (user_id) => {
  try {


    if (!user_id) {
      return null;
    }

    const userInfoRedisKey = `${process.env.APP_ENV}_user_info_${user_id}`
    const value = await getOrAddDataInRedis(userInfoRedisKey)

    if (value) {
      return value
    }


    const userData = await User.findOne({
      $or: [
        { _id: user_id },
      ]
    }, { projection }).exec();

    return userData ? responseFormatterForAuth(userData) : null;

  } catch (error) {
    logger.error("Error in getOrAdduser:", error);
    return null
  }
}


module.exports = {
  getAuth,
  createAuth,
  verifyOTP,
  generateMagicLink,
  verifyMagicToken,
  generateOTP,
  getOrAdduser,
  responseFormatterForAuth,
  createUser
};