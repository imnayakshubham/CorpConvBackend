'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const backupCodeSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  // bcrypt hash of the plain-text code — plain text is NEVER stored
  codeHash: {
    type: String,
    required: true,
  },
  used: {
    type: Boolean,
    default: false,
  },
  usedAt: {
    type: Date,
    default: null,
  },
  usedFromIp: {
    type: String,
    default: null,
  },
  invalidated: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

// Compound index for fast per-user lookup of unused, valid codes
backupCodeSchema.index({ userId: 1, used: 1, invalidated: 1 });

/**
 * Generates `count` cryptographically secure backup codes.
 * Format: XXXXX-XXXXX (10 hex chars split by a dash)
 *
 * Deletes all previous codes for the user (invalidation), then inserts new ones.
 *
 * @param {string|ObjectId} userId
 * @param {number} [count=10]
 * @returns {string[]}  Plain-text codes shown to user ONCE — never stored
 */
backupCodeSchema.statics.generateForUser = async function (userId, count = 10) {
  // Invalidate old codes
  await this.updateMany({ userId }, { $set: { invalidated: true } });

  const plainCodes = [];
  const docs = [];

  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); // e.g. "A3F2B"
    const raw2 = crypto.randomBytes(5).toString('hex').toUpperCase();
    const plain = `${raw}-${raw2}`; // e.g. "A3F2B-C91D4"
    plainCodes.push(plain);
    const codeHash = await bcrypt.hash(plain, 10);
    docs.push({ userId, codeHash, used: false, invalidated: false });
  }

  await this.insertMany(docs);
  return plainCodes;
};

/**
 * Verifies a backup code against all active (unused, non-invalidated) codes for the user.
 * Marks the matched code as used on success.
 *
 * @param {string|ObjectId} userId
 * @param {string} plainCode       Code entered by the user
 * @param {string} [ipAddress]     For audit logging
 * @returns {{ valid: boolean, remaining?: number }}
 */
backupCodeSchema.statics.verifyCode = async function (userId, plainCode, ipAddress) {
  const activeCodes = await this.find({ userId, used: false, invalidated: false });

  for (const code of activeCodes) {
    const match = await bcrypt.compare(plainCode.trim().toUpperCase(), code.codeHash);
    if (match) {
      code.used = true;
      code.usedAt = new Date();
      code.usedFromIp = ipAddress || null;
      await code.save();

      const remaining = await this.countDocuments({ userId, used: false, invalidated: false });
      return { valid: true, remaining };
    }
  }

  return { valid: false };
};

/**
 * Returns the count of remaining unused codes for a user.
 */
backupCodeSchema.statics.remainingCount = async function (userId) {
  return this.countDocuments({ userId, used: false, invalidated: false });
};

const BackupCode = mongoose.model('BackupCode', backupCodeSchema);
module.exports = BackupCode;
