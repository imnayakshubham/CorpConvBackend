'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const secondaryEmailOtpSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  // Never store plain-text OTP — only the bcrypt hash
  otpHash: {
    type: String,
    required: true,
  },
  attempts: {
    type: Number,
    default: 0,
  },
  expiresAt: {
    type: Date,
    required: true,
    // MongoDB TTL index — document is deleted automatically after expiry
    index: { expires: 0 },
  },
}, { timestamps: true });

/**
 * Generates a 6-digit OTP, hashes it, and stores the record.
 * Replaces any existing pending OTP for the same user+email combination.
 *
 * @param {string} userId
 * @param {string} email
 * @returns {{ otp: string }}  Plain-text OTP (send to user, do NOT store)
 */
secondaryEmailOtpSchema.statics.createOtp = async function (userId, email) {
  const crypto = require('crypto');
  const otp = String(crypto.randomInt(100000, 999999));
  const otpHash = await bcrypt.hash(otp, 10);

  await this.deleteMany({ userId, email });

  await this.create({
    userId,
    email: email.toLowerCase().trim(),
    otpHash,
    attempts: 0,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
  });

  return { otp };
};

/**
 * Verifies the OTP.
 * Returns true and deletes the record on success.
 * Increments attempt counter on failure (max 5 attempts before auto-lockout).
 *
 * @param {string} userId
 * @param {string} email
 * @param {string} otp   Plain-text OTP entered by the user
 * @returns {{ valid: boolean, reason?: string }}
 */
secondaryEmailOtpSchema.statics.verifyOtp = async function (userId, email, otp) {
  const record = await this.findOne({
    userId,
    email: email.toLowerCase().trim(),
    expiresAt: { $gt: new Date() },
  });

  if (!record) {
    return { valid: false, reason: 'OTP not found or expired' };
  }

  if (record.attempts >= 5) {
    await record.deleteOne();
    return { valid: false, reason: 'Too many failed attempts. Please request a new OTP.' };
  }

  const match = await bcrypt.compare(String(otp), record.otpHash);

  if (!match) {
    record.attempts += 1;
    await record.save();
    return { valid: false, reason: 'Invalid OTP' };
  }

  await record.deleteOne();
  return { valid: true };
};

const SecondaryEmailOtp = mongoose.model('SecondaryEmailOtp', secondaryEmailOtpSchema);
module.exports = SecondaryEmailOtp;
