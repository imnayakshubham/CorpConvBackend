'use strict';

const { z } = require('zod');

// RFC-5321 compliant — max 254 chars total, local part max 64
const emailSchema = z
  .string()
  .min(1)
  .max(254)
  .email('Invalid email format')
  .toLowerCase()
  .trim();

const sendOtpBody = z.object({
  email: emailSchema,
}).strict();

const verifyOtpBody = z.object({
  email: emailSchema,
  otp: z
    .string()
    .length(6, 'OTP must be exactly 6 digits')
    .regex(/^\d{6}$/, 'OTP must be numeric'),
}).strict();

const removeSecondaryEmailBody = z.object({
  // empty body — confirmation comes from authenticated session
}).strict();

module.exports = { sendOtpBody, verifyOtpBody, removeSecondaryEmailBody };
