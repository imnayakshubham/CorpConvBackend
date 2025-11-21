const { MagicLink, OTP } = require('../models/authModels');
const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Unified Authentication Service
 *
 * Provides BOTH magic link and OTP in a single email
 * Users can choose either method to authenticate
 */

/**
 * Generate and store both magic link and OTP for an email
 * @param {string} email - User's email address
 * @returns {Promise<Object>} - Returns { token, otp, magicUrl, expiresAt }
 */
async function sendUnifiedAuthEmail(email) {
  try {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Generate magic link token (32 bytes hex)
    const token = crypto.randomBytes(32).toString('hex');

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store magic link in database
    await MagicLink.create({
      email,
      token,
      expiresAt,
      used: false
    });

    // Store OTP in database
    await OTP.create({
      email,
      otp,
      expiresAt,
      type: 'sign_in',
      attempts: 0,
      used: false
    });

    // Generate magic link URL
    const baseUrl = process.env.FRONTEND_URL || process.env.ALLOW_ORIGIN?.split(',')[0] || 'http://localhost:3005';
    const magicUrl = `${baseUrl}/verify?token=${token}&email=${encodeURIComponent(email)}&type=magic-link`;

    logger.info(`Generated auth credentials for ${email}`);

    return {
      success: true,
      token,
      otp,
      magicUrl,
      expiresAt
    };
  } catch (error) {
    logger.error('Failed to generate unified auth:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Verify magic link token
 * @param {string} email - User's email
 * @param {string} token - Magic link token
 * @returns {Promise<Object>} - Verification result
 */
async function verifyMagicLink(email, token) {
  try {
    const magicLink = await MagicLink.findOne({
      email,
      token,
      used: false
    });

    if (!magicLink) {
      return {
        success: false,
        error: 'Magic link not found or already used'
      };
    }

    // Check expiration
    if (new Date() > magicLink.expiresAt) {
      await MagicLink.deleteOne({ _id: magicLink._id });
      return {
        success: false,
        error: 'Magic link has expired'
      };
    }

    // Mark as used
    magicLink.used = true;
    await magicLink.save();

    // Also invalidate OTP for this email (user chose magic link)
    await OTP.updateMany(
      { email, used: false },
      { $set: { used: true } }
    );

    logger.info(`Magic link verified for ${email}`);

    return {
      success: true,
      method: 'magic-link',
      email
    };
  } catch (error) {
    logger.error('Magic link verification error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Verify OTP code
 * @param {string} email - User's email
 * @param {string} otpCode - 6-digit OTP code
 * @returns {Promise<Object>} - Verification result
 */
async function verifyOTP(email, otpCode) {
  try {
    const otpRecord = await OTP.findOne({
      email,
      otp: otpCode,
      used: false
    });

    if (!otpRecord) {
      // Increment attempt counter if OTP exists
      await OTP.updateOne(
        { email, used: false },
        { $inc: { attempts: 1 } }
      );

      return {
        success: false,
        error: 'Invalid OTP code'
      };
    }

    // Check expiration
    if (new Date() > otpRecord.expiresAt) {
      await OTP.deleteOne({ _id: otpRecord._id });
      return {
        success: false,
        error: 'OTP has expired'
      };
    }

    // Check max attempts
    if (otpRecord.attempts >= 5) {
      await OTP.deleteOne({ _id: otpRecord._id });
      return {
        success: false,
        error: 'Too many failed attempts. Please request a new code.'
      };
    }

    // Mark as used
    otpRecord.used = true;
    await otpRecord.save();

    // Also invalidate magic link for this email (user chose OTP)
    await MagicLink.updateMany(
      { email, used: false },
      { $set: { used: true } }
    );

    logger.info(`OTP verified for ${email}`);

    return {
      success: true,
      method: 'otp',
      email
    };
  } catch (error) {
    logger.error('OTP verification error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Unified verification - automatically detects if input is OTP or magic link token
 * @param {string} email - User's email
 * @param {string} input - Either 6-digit OTP or magic link token
 * @returns {Promise<Object>} - Verification result
 */
async function verifyUnifiedAuth(email, input) {
  if (!email || !input) {
    return {
      success: false,
      error: 'Email and verification code/token required'
    };
  }

  // Detect if input is OTP (6 digits) or magic link token (hex string)
  if (/^\d{6}$/.test(input)) {
    // Input is 6-digit OTP
    return await verifyOTP(email, input);
  } else if (/^[a-f0-9]{64}$/i.test(input)) {
    // Input is 64-character hex token (magic link)
    return await verifyMagicLink(email, input);
  } else {
    return {
      success: false,
      error: 'Invalid verification format'
    };
  }
}

/**
 * Clean up expired magic links and OTPs
 * Should be called periodically (e.g., via cron job)
 */
async function cleanupExpiredAuth() {
  try {
    const now = new Date();

    const magicLinkResult = await MagicLink.deleteMany({
      expiresAt: { $lt: now }
    });

    const otpResult = await OTP.deleteMany({
      expiresAt: { $lt: now }
    });

    logger.info(`Cleaned up ${magicLinkResult.deletedCount} magic links and ${otpResult.deletedCount} OTPs`);

    return {
      magicLinks: magicLinkResult.deletedCount,
      otps: otpResult.deletedCount
    };
  } catch (error) {
    logger.error('Cleanup error:', error);
    return { error: error.message };
  }
}

module.exports = {
  sendUnifiedAuthEmail,
  verifyMagicLink,
  verifyOTP,
  verifyUnifiedAuth,
  cleanupExpiredAuth
};
