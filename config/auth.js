const { betterAuth } = require("better-auth");
const { mongodbAdapter } = require("better-auth/adapters/mongodb");
const { passkey } = require("better-auth/plugins/passkey");
const { emailOTP } = require("better-auth/plugins/email-otp");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const logger = require("../utils/logger");
const emailService = require("../services/emailService");


// Generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Store OTP in Redis or memory (for production use Redis)
const otpStore = new Map();

// Validate and provide fallback for baseURL
const baseURL = process.env.BETTER_AUTH_URL || process.env.ALLOW_ORIGIN?.split(',')[0] || "http://localhost:5000";
if (!process.env.BETTER_AUTH_URL && !process.env.ALLOW_ORIGIN) {
  logger.warn(`BETTER_AUTH_URL not configured - using fallback: ${baseURL}`);
}


const auth = betterAuth({
  database: mongodbAdapter(mongoose.connection.db),

  secret: process.env.BETTER_AUTH_SECRET || process.env.JWT_SECRET_KEY,
  baseURL,

  // Session configuration
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5 // 5 minutes
    }
  },

  // Cookie configuration for cross-domain
  cookies: {
    sessionToken: {
      name: "better-auth.session_token",
      options: {
        httpOnly: true,
        secure: process.env.APP_ENV === 'PROD',
        sameSite: process.env.APP_ENV === 'PROD' ? 'none' : 'lax',
        maxAge: 60 * 60 * 24 * 7 * 1000, // 7 days in ms
        path: '/',
        domain: process.env.APP_ENV === 'PROD' ? undefined : 'localhost'
      }
    }
  },

  // Social providers
  socialProviders: {
    google: {
      clientId: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      scope: ["openid", "email", "profile"],
      // Map Google profile to our user schema
      mapProfile: (profile) => ({
        sub: profile.sub,
        email: profile.email,
        name: profile.name,
        image: profile.picture,
        emailVerified: profile.email_verified
      })
    }
  },

  // User configuration
  user: {
    modelName: "User",
    fields: {
      email: "user_email_id",
      name: "public_user_name",
      image: "user_public_profile_pic",
      emailVerified: "is_email_verified"
    },
    additionalFields: {
      user_bio: {
        type: "string",
        required: false
      },
      user_job_role: {
        type: "string",
        required: false
      },
      user_location: {
        type: "string",
        required: false
      },
      user_current_company_name: {
        type: "string",
        required: false
      },
      is_anonymous: {
        type: "boolean",
        defaultValue: false
      },
      access: {
        type: "boolean",
        defaultValue: true
      }
    }
  },

  // Email verification
  emailVerification: {
    sendVerificationEmail: async ({ user, url, token }) => {

      const transporter = emailService.createTransporter()

      try {
        await transporter.sendMail({
          from: `"${process.env.APP_NAME || 'Hushwork'}" <${process.env.EMAIL_USER}>`,
          to: user.email,
          subject: "Verify your email address",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #333;">Welcome to ${process.env.APP_NAME || 'Hushwork'}!</h2>
              <p>Please verify your email address by clicking the button below:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${url}"
                   style="background: #007bff; color: white; padding: 12px 24px;
                          text-decoration: none; border-radius: 6px; display: inline-block;">
                  Verify Email Address
                </a>
              </div>
              <p style="color: #666; font-size: 14px;">
                If the button doesn't work, copy and paste this link into your browser:<br>
                <a href="${url}">${url}</a>
              </p>
              <p style="color: #666; font-size: 14px;">
                This link will expire in 24 hours for security reasons.
              </p>
            </div>
          `
        });

        logger.info(`Verification email sent to ${user.email}`);
      } catch (error) {
        logger.error("Failed to send verification email:", error);
        throw new Error("Failed to send verification email");
      }
    },

    // Custom verification URL
    verificationPath: "/api/verify-email",
    expiresIn: 60 * 60 * 24 // 24 hours
  },

  // Plugin configuration
  plugins: [
    // Passkey authentication
    passkey({
      rpName: process.env.APP_NAME || "Hushwork",
      rpID: process.env.APP_ENV === 'PROD'
        ? new URL(process.env.BETTER_AUTH_URL || '').hostname
        : "localhost",
      origin: process.env.APP_ENV === 'PROD'
        ? [process.env.BETTER_AUTH_URL]
        : ["http://localhost:3005", "http://localhost:8000"]
    }),

    // Email OTP for magic links
    emailOTP({
      async sendOTP({ email, otp, type }) {
        const transporter = emailService.createTransporter();

        try {
          // Store OTP for verification (in production, use Redis)
          otpStore.set(email, {
            otp,
            expires: Date.now() + (10 * 60 * 1000), // 10 minutes
            type
          });

          let subject, html;

          if (type === 'sign-in') {
            subject = "Your sign-in code";
            html = `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">Sign in to ${process.env.APP_NAME || 'Hushwork'}</h2>
                <p>Use this code to sign in to your account:</p>
                <div style="text-align: center; margin: 30px 0;">
                  <div style="background: #f8f9fa; border: 2px solid #007bff;
                              padding: 20px; border-radius: 8px; display: inline-block;">
                    <span style="font-size: 32px; font-weight: bold; color: #007bff;
                                 letter-spacing: 8px;">${otp}</span>
                  </div>
                </div>
                <p style="color: #666; font-size: 14px;">
                  This code will expire in 10 minutes for security reasons.
                </p>
                <p style="color: #666; font-size: 14px;">
                  If you didn't request this code, you can safely ignore this email.
                </p>
              </div>
            `;
          } else {
            subject = "Your verification code";
            html = `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">Verify your email</h2>
                <p>Use this code to verify your email address:</p>
                <div style="text-align: center; margin: 30px 0;">
                  <div style="background: #f8f9fa; border: 2px solid #28a745;
                              padding: 20px; border-radius: 8px; display: inline-block;">
                    <span style="font-size: 32px; font-weight: bold; color: #28a745;
                                 letter-spacing: 8px;">${otp}</span>
                  </div>
                </div>
                <p style="color: #666; font-size: 14px;">
                  This code will expire in 10 minutes for security reasons.
                </p>
              </div>
            `;
          }

          await transporter.sendMail({
            from: `"${process.env.APP_NAME || 'Hushwork'}" <${process.env.EMAIL_USER}>`,
            to: email,
            subject,
            html
          });

          logger.info(`OTP email sent to ${email}`);
        } catch (error) {
          logger.error("Failed to send OTP email:", error);
          throw new Error("Failed to send OTP email");
        }
      },

      expiresIn: 60 * 10, // 10 minutes
      otpLength: 6
    })
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
  }
});

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
  auth,
  verifyOTP,
  generateMagicLink,
  verifyMagicToken,
  generateOTP
};