const { betterAuth } = require("better-auth");
const { mongodbAdapter } = require("better-auth/adapters/mongodb");
const { passkey } = require("better-auth/plugins/passkey");
const { emailOTP } = require("better-auth/plugins/email-otp");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const logger = require("../utils/logger");
const emailService = require("../services/emailService");
const { betterAuthSessionCookie } = require("../constants");


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

    /**
     * User Configuration - Only Store Public Information
     *
     * SECURITY: Better Auth sessions should ONLY contain publicly available user data.
     * Sensitive information (email, actual_name, phone_number) is encrypted in the database
     * and should NEVER be included in the session.
     */
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
        scope: ["openid", "email", "profile"],
        mapProfile: (profile) => ({
          user_id: profile.sub
        })
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


module.exports = {
  getAuth,
  createAuth,
  verifyOTP,
  generateMagicLink,
  verifyMagicToken,
  generateOTP
};