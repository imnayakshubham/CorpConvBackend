const express = require("express");
const {
  registerUser,
  authUser,
  allUsers,
  logout,
  updateUserProfile,
  fetchUsers,
  sendFollowRequest,
  acceptFollowRequest,
  rejectFollowRequest,
  getfollowersList,
  getUserInfo,
  updateUserProfileDetails,
  addProfileItem, deleteProfileItem, updateProfileItem,
  getProfile,
  updateLayouts,
  getUserRecommendations,
  refreshToken,
  getCurrentUser,
  sendMagicLink,
  verifyAuth,
  updatePremiumStatus,

} = require("../controllers/userControllers");
const { protect } = require("../middleware/authMiddleware");
const { verifyOTP, verifyMagicToken } = require("../config/auth");
const { MagicLink, OTP } = require("../models/authModels");
const { sendUnifiedAuthEmail, verifyUnifiedAuth } = require("../services/unifiedAuth");
const asyncHandler = require("express-async-handler");
const nodemailer = require("nodemailer");
const logger = require("../utils/logger");
const emailService = require("../services/emailService");

const router = express.Router();

// DEPRECATED: JWT refresh endpoint - Better Auth handles session refresh automatically
// router.post("/auth/refresh", refreshToken);

router.get("/auth/me", protect, getCurrentUser);
router.post("/auth/logout", protect, logout);

// Premium management
router.put("/premium", protect, updatePremiumStatus);

// Better-auth handler - handles all remaining better-auth routes
// This must come AFTER custom auth routes to avoid conflicts


// Unified Magic Link + OTP Authentication
router.post("/send-magic-link", asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      error: "Email is required"
    });
  }
  console.log({ email })

  try {
    // Generate both magic link and OTP
    const result = await sendUnifiedAuthEmail(email);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }

    // Send unified auth email with both options
    const transporter = emailService.createTransporter()

    await transporter.sendMail({
      from: `"${process.env.APP_NAME || 'Hushwork'}" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Sign in to your account",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Sign in to ${process.env.APP_NAME || 'Hushwork'}</h2>
          <p style="color: #555; font-size: 16px;">Choose your preferred method to sign in:</p>

          <!-- Option 1: Magic Link -->
          <div style="background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <h3 style="color: #333; margin-top: 0;">Option 1: Magic Link</h3>
            <p style="color: #666;">Click the button below for instant sign-in:</p>
            <div style="text-align: center; margin: 20px 0;">
              <a href="${result.magicUrl}"
                 style="background: #007bff; color: white; padding: 14px 32px;
                        text-decoration: none; border-radius: 6px; display: inline-block;
                        font-weight: 600; font-size: 16px;">
                Sign In with Magic Link
              </a>
            </div>
            <p style="color: #999; font-size: 13px; margin-bottom: 0;">
              If the button doesn't work, copy this link:<br>
              <a href="${result.magicUrl}" style="color: #007bff; word-break: break-all;">${result.magicUrl}</a>
            </p>
          </div>

          <!-- Divider -->
          <div style="text-align: center; margin: 30px 0;">
            <span style="color: #999; font-size: 14px; background: white; padding: 0 10px;">OR</span>
            <hr style="margin-top: -12px; border: none; border-top: 1px solid #ddd;">
          </div>

          <!-- Option 2: OTP -->
          <div style="background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <h3 style="color: #333; margin-top: 0;">Option 2: One-Time Code</h3>
            <p style="color: #666;">Enter this 6-digit code on the sign-in page:</p>
            <div style="text-align: center; margin: 20px 0;">
              <div style="background: white; border: 2px solid #007bff; border-radius: 8px;
                          padding: 20px; display: inline-block;">
                <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #007bff;">
                  ${result.otp}
                </span>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
            <p style="color: #666; font-size: 14px;">
              ⏱️ Both options will expire in <strong>15 minutes</strong> for security.
            </p>
            <p style="color: #666; font-size: 14px;">
              🔒 If you didn't request this, you can safely ignore this email.
            </p>
          </div>
        </div>
      `
    });

    logger.info(`Unified auth (magic link + OTP) sent to ${email}`);

    res.status(200).json({
      success: true,
      message: "Sign-in options sent to your email"
    });

  } catch (error) {
    logger.error("Failed to send magic link:", error);
    res.status(500).json({
      success: false,
      error: "Failed to send magic link"
    });
  }
}));

// Verification Route - handles both magic link and OTP verification
router.route("/verify").get(asyncHandler(async (req, res) => {
  const { token, email, otp, type = 'magic-link' } = req.query;

  try {
    if (type === 'magic-link' && token && email) {
      // Verify magic link token
      const result = verifyMagicToken(email, token);

      if (result.success) {
        // Find or create user
        const { User } = require("../models/userModel");
        let user = await User.findOne({ user_email_id: email });

        if (!user) {
          // Create new user for magic link sign-in
          const emailSplit = email.split("@");
          const domain = emailSplit[1].split(".")[0];
          const Company = require("../models/companySchema");

          const companyExist = await Company.findOne({
            company_name: domain.charAt(0).toUpperCase() + domain.slice(1)
          });

          const companyId = companyExist?.company_id || new mongoose.Types.ObjectId();

          if (!companyExist) {
            const company = new Company({
              company_id: companyId,
              company_name: domain.charAt(0).toUpperCase() + domain.slice(1)
            });
            await company.save();
          }

          user = new User({
            user_email_id: email,
            public_user_name: email.split('@')[0],
            is_email_verified: true,
            is_anonymous: false,
            user_current_company_name: !["example", "gmail", "outlook"].includes(domain)
              ? domain.charAt(0).toUpperCase() + domain.slice(1)
              : "Somewhere",
            user_company_id: companyId,
            user_past_company_history: [companyId],
            primary_email_domain: emailSplit[1],
            emailVerified: new Date(),
            access: true,
            authMethods: {
              email: true,
              google: true,
              passkey: false
            }
          });

          await user.save();
        } else {
          // Update email verification status
          user.is_email_verified = true;
          user.emailVerified = new Date();
          await user.save();
        }

        // Create session using BetterAuth
        // Redirect to success page with token
        return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3005'}/dashboard?auth=success`);
      } else {
        return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3005'}/verify?error=${encodeURIComponent(result.error)}`);
      }
    }

    // If no valid verification method, redirect to verify page
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3005'}/verify`);

  } catch (error) {
    logger.error("Verification error:", error);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3005'}/verify?error=verification_failed`);
  }
})).post(asyncHandler(async (req, res) => {
  const { email, otp, type = 'otp' } = req.body;

  if (!email || !otp) {
    return res.status(400).json({
      success: false,
      error: "Email and OTP are required"
    });
  }

  try {
    // Verify OTP
    const result = verifyOTP(email, otp);

    if (result.success) {
      // Find or create user (similar to magic link logic)
      const { User } = require("../models/userModel");
      let user = await User.findOne({ user_email_id: email });

      if (!user) {
        // Create new user logic (same as above)
        const emailSplit = email.split("@");
        const domain = emailSplit[1].split(".")[0];
        const Company = require("../models/companySchema");

        const companyExist = await Company.findOne({
          company_name: domain.charAt(0).toUpperCase() + domain.slice(1)
        });

        const companyId = companyExist?.company_id || new mongoose.Types.ObjectId();

        if (!companyExist) {
          const company = new Company({
            company_id: companyId,
            company_name: domain.charAt(0).toUpperCase() + domain.slice(1)
          });
          await company.save();
        }

        user = new User({
          user_email_id: email,
          public_user_name: email.split('@')[0],
          is_email_verified: true,
          is_anonymous: false,
          user_current_company_name: !["example", "gmail", "outlook"].includes(domain)
            ? domain.charAt(0).toUpperCase() + domain.slice(1)
            : "Somewhere",
          user_company_id: companyId,
          user_past_company_history: [companyId],
          primary_email_domain: emailSplit[1],
          emailVerified: new Date(),
          access: true,
          authMethods: {
            email: true,
            google: true,
            passkey: false
          }
        });

        await user.save();
      }

      res.status(200).json({
        success: true,
        message: "OTP verified successfully",
        data: {
          user: {
            _id: user._id,
            user_email_id: user.user_email_id,
            public_user_name: user.public_user_name,
            is_email_verified: user.is_email_verified
          }
        }
      });

    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    logger.error("OTP verification error:", error);
    res.status(500).json({
      success: false,
      error: "OTP verification failed"
    });
  }
}));

router.route("/user").get(protect, allUsers);
router.route('/user/recommend/:user_id?').get(getUserRecommendations);
router.route("/user/:id").get(getUserInfo)
router.route("/followers").get(protect, getfollowersList);

// DEPRECATED: Legacy JWT auth endpoint - Use Better Auth instead (/api/auth/*)
// router.post("/auth", authUser);

router.route("/users").post(fetchUsers);

// DEPRECATED: Use Better Auth signOut instead
// router.route("/logout").post(protect, logout)
router.route("/update-profile").post(protect, updateUserProfile);
router.route("/update-profile-details").post(protect, updateUserProfileDetails);

router.route("/send-follow-request").post(protect, sendFollowRequest);
router.route("/accept-follow-request").post(protect, acceptFollowRequest);
router.route("/reject-follow-request").post(protect, rejectFollowRequest);


router
  .route('/:user_id/profile')
  .get(protect, getProfile);

// Route: Add item or update layouts
router.route('/:user_id/profile/items').post(protect, addProfileItem);

// Route: Update or delete a specific item
router
  .route('/:user_id/profile/items/:item_id')
  .put(protect, updateProfileItem)
  .delete(protect, deleteProfileItem);

// Route: Update layouts (all breakpoints)
router
  .route('/user/:user_id/profile/layouts')
  .put(protect, updateLayouts);

// Note: Firebase auth routes (firebase-google, refresh, me, logout) are registered
// at the top of this file under /auth/* to ensure proper route precedence

// Better-auth integration routes (non-auth paths)
router.post("/send-magic-link", sendMagicLink);
router.post("/verify", verifyAuth);

module.exports = router;
