'use strict';

const asyncHandler = require('express-async-handler');
const User = require('../models/userModel');
const SecondaryEmailOtp = require('../models/secondaryEmailOtpModel');
const { isDisposableEmail, hasMxRecord } = require('../utils/disposableEmailDomains');
const { sendRawEmail } = require('../utils/emailService');
const cache = require('../redisClient/cacheHelper');
// OtpVerificationEmail (TSX) is intentionally NOT required here — the TSX file
// requires a tsx runner and is only used in the email preview/bulk-send scripts.
// The active email sender uses the plain JS template below.
const { buildOtpEmailHtml } = require('../emails/otpEmailTemplate');

// ---------------------------------------------------------------------------
// POST /secondary-email/send-otp
// Validates the email, sends a 6-digit OTP.
// Rate-limited upstream: 3 requests / 15 min per user.
// ---------------------------------------------------------------------------
const sendOtp = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { email } = req.body; // already lowercased + trimmed by Zod

  // 1. Must be different from primary
  const user = await User.findById(userId, { user_email_id: 1, actual_user_name: 1 });
  if (!user) return res.status(404).json({ status: 'Failed', message: 'User not found' });

  if (email === user.user_email_id?.toLowerCase()) {
    return res.status(400).json({
      status: 'Failed',
      message: "That's your primary email address. Please use a different email.",
    });
  }

  // 2. Disposable domain check (instant, no network)
  if (isDisposableEmail(email)) {
    return res.status(400).json({
      status: 'Failed',
      message: 'Disposable or temporary email addresses are not allowed',
    });
  }

  // 3. MX record check (network, with 3 s timeout)
  const hasMx = await hasMxRecord(email);
  if (!hasMx) {
    return res.status(400).json({
      status: 'Failed',
      message: 'This email domain does not appear to accept email. Please use a real email address.',
    });
  }

  // 4. Check this email isn't already a verified secondary on another account
  const existingOwner = await User.findOne({
    secondary_email_id: email,
    is_secondary_email_id_verified: true,
    _id: { $ne: userId },
  });
  if (existingOwner) {
    return res.status(400).json({
      status: 'Failed',
      message: 'This email is already in use as a secondary email',
    });
  }

  // 5. Generate and send OTP
  const { otp } = await SecondaryEmailOtp.createOtp(userId, email);

  try {
    await sendRawEmail({
      to: email,
      subject: 'Verify your secondary email — Hushwork',
      html: buildOtpEmailHtml({ otp, email, userName: user.actual_user_name }),
    });
  } catch (err) {
    // Email send failure — clean up the OTP record so user can retry
    await SecondaryEmailOtp.deleteMany({ userId, email });
    return res.status(503).json({
      status: 'Failed',
      message: 'Failed to send verification email. Please try again.',
    });
  }

  return res.status(200).json({
    status: 'Success',
    message: `A 6-digit code has been sent to ${email}. It expires in 10 minutes.`,
  });
});

// ---------------------------------------------------------------------------
// POST /secondary-email/verify-otp
// Verifies the OTP. Marks email as verified on success.
// Rate-limited upstream: 5 requests / 15 min per user.
// ---------------------------------------------------------------------------
const verifyOtp = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { email, otp } = req.body;

  const result = await SecondaryEmailOtp.verifyOtp(userId, email, otp);

  if (!result.valid) {
    return res.status(400).json({ status: 'Failed', message: result.reason });
  }

  // Mark secondary email as verified in the user doc
  const domain = email.split('@')[1];
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        secondary_email_id: email,
        is_secondary_email_id_verified: true,
        secondary_email_domain: domain,
      },
    }
  );

  // Invalidate user profile cache
  const cacheKey = cache.generateKey('user', 'info', userId.toString());
  await cache.del(cacheKey);

  return res.status(200).json({
    status: 'Success',
    message: 'Secondary email verified and saved successfully',
    result: { secondary_email_id: email, is_secondary_email_id_verified: true },
  });
});

// ---------------------------------------------------------------------------
// DELETE /secondary-email
// Removes the secondary email from the user account.
// ---------------------------------------------------------------------------
const removeSecondaryEmail = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        secondary_email_id: null,
        is_secondary_email_id_verified: false,
        secondary_email_domain: null,
      },
    }
  );

  // Clean up any pending OTPs
  await SecondaryEmailOtp.deleteMany({ userId });

  const cacheKey = cache.generateKey('user', 'info', userId.toString());
  await cache.del(cacheKey);

  return res.status(200).json({
    status: 'Success',
    message: 'Secondary email removed',
  });
});

// ---------------------------------------------------------------------------
// GET /secondary-email/status
// Returns current secondary email status for the authenticated user.
// ---------------------------------------------------------------------------
const getStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(
    req.user._id,
    { secondary_email_id: 1, is_secondary_email_id_verified: 1 }
  );

  return res.status(200).json({
    status: 'Success',
    result: {
      secondary_email_id: user?.secondary_email_id ?? null,
      is_secondary_email_id_verified: user?.is_secondary_email_id_verified ?? false,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /secondary-email/save
// Saves (or updates) the secondary email WITHOUT OTP verification.
// All validation still runs (disposable, MX, uniqueness).
// is_secondary_email_id_verified is set to false — OTP flow verifies it later.
// ---------------------------------------------------------------------------
const saveEmail = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { email } = req.body;

  const user = await User.findById(userId, {
    user_email_id: 1,
    actual_user_name: 1,
    secondary_email_change_count: 1,
    secondary_email_change_year: 1,
  });
  if (!user) return res.status(404).json({ status: 'Failed', message: 'User not found' });

  // 2x/year change limit
  const currentYear = new Date().getFullYear();
  const effectiveCount =
    user.secondary_email_change_year === currentYear
      ? (user.secondary_email_change_count ?? 0)
      : 0;

  if (effectiveCount >= 2) {
    return res.status(429).json({
      status: 'Failed',
      message: 'You can only change your secondary email twice per year. If you need help, please submit feedback.',
      limitReached: true,
    });
  }

  if (email === user.user_email_id?.toLowerCase()) {
    return res.status(400).json({
      status: 'Failed',
      message: "That's your primary email address. Please use a different email.",
    });
  }

  // Check if this email is a primary email of any other account
  const primaryOwner = await User.findOne({
    user_email_id: email,
    _id: { $ne: userId },
  });
  if (primaryOwner) {
    return res.status(400).json({
      status: 'Failed',
      message: 'An account with this email address already exists.',
    });
  }

  if (isDisposableEmail(email)) {
    return res.status(400).json({
      status: 'Failed',
      message: 'Disposable or temporary email addresses are not allowed',
    });
  }

  const hasMx = await hasMxRecord(email);
  if (!hasMx) {
    return res.status(400).json({
      status: 'Failed',
      message: 'This email domain does not appear to accept email. Please use a real email address.',
    });
  }

  const existingOwner = await User.findOne({
    secondary_email_id: email,
    is_secondary_email_id_verified: true,
    _id: { $ne: userId },
  });
  if (existingOwner) {
    return res.status(400).json({
      status: 'Failed',
      message: 'This email is already in use as a secondary email on another account.',
    });
  }

  const domain = email.split('@')[1];
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        secondary_email_id: email,
        is_secondary_email_id_verified: false,
        secondary_email_domain: domain,
        secondary_email_change_count: effectiveCount + 1,
        secondary_email_change_year: currentYear,
      },
    }
  );

  const cacheKey = cache.generateKey('user', 'info', userId.toString());
  await cache.del(cacheKey);

  return res.status(200).json({
    status: 'Success',
    message: 'Secondary email saved',
    result: { secondary_email_id: email, is_secondary_email_id_verified: false },
  });
});

module.exports = { sendOtp, verifyOtp, removeSecondaryEmail, getStatus, saveEmail };
