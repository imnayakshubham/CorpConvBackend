'use strict';

const express = require('express');
const { sendOtp, verifyOtp, removeSecondaryEmail, getStatus, saveEmail } = require('../controllers/secondaryEmailController');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { emailOtpSendLimiter, emailOtpVerifyLimiter } = require('../middleware/rateLimiter');
const { sendOtpBody, verifyOtpBody } = require('../validators/secondaryEmailSchemas');

const router = express.Router();

// All routes require authentication
router.use(protect);

// GET  /secondary-email/status
router.get('/status', getStatus);

// POST /secondary-email/send-otp     → rate: 3/15 min per user
router.post('/send-otp', emailOtpSendLimiter, validate({ body: sendOtpBody }), sendOtp);

// POST /secondary-email/verify-otp   → rate: 5/15 min per user
router.post('/verify-otp', emailOtpVerifyLimiter, validate({ body: verifyOtpBody }), verifyOtp);

// POST /secondary-email/save         → save without OTP (OTP verification added later)
router.post('/save', validate({ body: sendOtpBody }), saveEmail);

// DELETE /secondary-email            → no body required
router.delete('/', removeSecondaryEmail);

module.exports = router;
