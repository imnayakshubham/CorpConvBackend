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
  firebaseGoogleAuth,
  refreshToken,
  getCurrentUser,
  sendMagicLink,
  verifyAuth,

} = require("../controllers/userControllers");
const { protect } = require("../middleware/authMiddleware");
const { auth, verifyOTP, generateMagicLink, verifyMagicToken } = require("../config/auth");
const { MagicLink, OTP } = require("../models/authModels");
const asyncHandler = require("express-async-handler");
const nodemailer = require("nodemailer");
const logger = require("../utils/logger");
const emailService = require("../services/emailService");

const router = express.Router();

// BetterAuth handler - handles all BetterAuth routes
router.all("/auth/*", async (req, res) => {
  return auth.handler(req, res);
});


// Magic Link Authentication
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
    // Generate magic link
    const result = await generateMagicLink(email);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }

    // Send magic link email
    const transporter = emailService.createTransporter()

    await transporter.sendMail({
      from: `"${process.env.APP_NAME || 'Hushwork'}" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Sign in to your account",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Sign in to ${process.env.APP_NAME || 'Hushwork'}</h2>
          <p>Click the button below to sign in to your account:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${result.url}"
               style="background: #007bff; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 6px; display: inline-block;">
              Sign In
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <a href="${result.url}">${result.url}</a>
          </p>
          <p style="color: #666; font-size: 14px;">
            This link will expire in 15 minutes for security reasons.
          </p>
          <p style="color: #666; font-size: 14px;">
            If you didn't request this link, you can safely ignore this email.
          </p>
        </div>
      `
    });

    logger.info(`Magic link sent to ${email}`);

    res.status(200).json({
      success: true,
      message: "Magic link sent to your email"
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
        const User = require("../models/userModel");
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
      const User = require("../models/userModel");
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
router.post("/auth", authUser);
router.route("/users").post(fetchUsers);
router.route("/logout").post(protect, logout)
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


router.post("/firebase-google", firebaseGoogleAuth);
router.post("/refresh", refreshToken);
router.get("/me", protect, getCurrentUser);
router.post("/logout", protect, logout);

// Better-auth integration routes
router.post("/send-magic-link", sendMagicLink);
router.post("/verify", verifyAuth);

module.exports = router;
