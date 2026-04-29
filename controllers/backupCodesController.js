'use strict';

const asyncHandler = require('express-async-handler');
const BackupCode = require('../models/backupCodesModel');

// ---------------------------------------------------------------------------
// POST /backup-codes/generate
// Generates 10 new backup codes for the user, invalidating any old ones.
// Returns codes ONCE — never again retrievable from the server.
// Rate-limited upstream: 3 / hour per user.
// ---------------------------------------------------------------------------
const generateCodes = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const plainCodes = await BackupCode.generateForUser(userId, 10);

  return res.status(201).json({
    status: 'Success',
    message: 'Backup codes generated. Save these securely — they will not be shown again.',
    result: {
      codes: plainCodes,
      warning: 'Each code can be used only once. Store them somewhere safe.',
    },
  });
});

// ---------------------------------------------------------------------------
// POST /backup-codes/verify
// Verifies a single backup code (used during account recovery / MFA fallback).
// Rate-limited upstream: 5 attempts / 15 min per IP.
// ---------------------------------------------------------------------------
const verifyCode = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { code } = req.body; // already trimmed + uppercased by Zod
  const ipAddress = req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim();

  const result = await BackupCode.verifyCode(userId, code, ipAddress);

  if (!result.valid) {
    // Deliberate vague message — don't confirm whether the code exists
    return res.status(400).json({
      status: 'Failed',
      message: 'Invalid or already used backup code',
    });
  }

  return res.status(200).json({
    status: 'Success',
    message: 'Backup code accepted',
    result: {
      remaining: result.remaining,
      lowWarning: result.remaining <= 2
        ? `Only ${result.remaining} backup code(s) remaining. Consider regenerating your codes.`
        : null,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /backup-codes/status
// Returns the count of remaining valid codes. Does NOT return the codes themselves.
// ---------------------------------------------------------------------------
const getStatus = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const remaining = await BackupCode.remainingCount(userId);

  return res.status(200).json({
    status: 'Success',
    result: {
      hasBackupCodes: remaining > 0,
      remaining,
    },
  });
});

// ---------------------------------------------------------------------------
// DELETE /backup-codes
// Invalidates all backup codes without generating new ones.
// ---------------------------------------------------------------------------
const invalidateCodes = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  await BackupCode.updateMany({ userId }, { $set: { invalidated: true } });

  return res.status(200).json({
    status: 'Success',
    message: 'All backup codes have been invalidated',
  });
});

module.exports = { generateCodes, verifyCode, getStatus, invalidateCodes };
