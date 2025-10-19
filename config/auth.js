const { betterAuth } = require("better-auth");
const { mongodbAdapter } = require("better-auth/adapters/mongodb");
const { passkey } = require("better-auth/plugins/passkey");
const { customSession } = require("better-auth/plugins");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const logger = require("../utils/logger");
const emailService = require("../services/emailService");
const { betterAuthSessionCookie, projection } = require("../constants");
const User = require("../models/userModel");
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
      additionalFields: {
        // Public profile fields only
        public_user_name: {
          type: "string",
          required: false,
        },
        user_public_profile_pic: {
          type: "string",
          required: false,
        },
        is_anonymous: {
          type: "boolean",
          required: false,
          defaultValue: true,
        },
        user_bio: {
          type: "string",
          required: false,
        },
        user_job_role: {
          type: "string",
          required: false,
        },
        user_job_experience: {
          type: "number",
          required: false,
        },
        user_current_company_name: {
          type: "string",
          required: false,
        },
        is_email_verified: {
          type: "boolean",
          required: false,
          defaultValue: false,
        },
        has_premium: {
          type: "boolean",
          required: false,
          defaultValue: false,
        },
        premium_plan: {
          type: "string",
          required: false,
          defaultValue: "free",
        },
        is_admin: {
          type: "boolean",
          required: false,
          defaultValue: false,
        },
      },
    },

    advanced: {
      cookies: {

        session_token: {
          name: betterAuthSessionCookie,

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
        mapProfileToUser: (profile) => {
          return {
            actual_user_name: profile?.name || `${profile?.given_name || ''} ${profile?.family_name || ''}`.trim(),
            is_email_verified: Boolean(profile?.email_verified),
            user_email_id: profile?.email,
            is_anonymous: true,   // you may want to set this based on some logic instead of always true
            user_phone_number: profile?.phoneNumber || null,
            actual_profile_pic: profile?.picture || profile?.photoURL || null,
            providerId: profile?.providerId || "google",
            meta_data: profile?.metadata || null,
            provider: profile?.providerId ?? "google",
            ...profile
          };
        }
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

    ],

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
    return userActualData;
  } catch (error) {
    logger.error("Error creating user:", error);
    throw error;
  }
}

const getOrAdduser = async (user_data) => {
  try {

    const { email: user_email_id } = user_data;

    if (!user_email_id) {
      return null;
    }
    const userData = await User.findOne({
      $or: [
        { user_email_id },
        { secondary_email_id: user_email_id }
      ]
    }, { projection }).exec();
    console.log({ userData })

    if (userData) {
      const userInfoRedisKey = `${process.env.APP_ENV}_user_info_${userData._id}`
      const value = await getOrAddDataInRedis(userInfoRedisKey, responseFormatterForAuth(userData))
      return value;
    } else {
      const newUser = await createUser(user_data);
      return newUser;
    }

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