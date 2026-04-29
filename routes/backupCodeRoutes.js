'use strict';

const express = require('express');
const { generateCodes, verifyCode, getStatus, invalidateCodes } = require('../controllers/backupCodesController');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { backupCodeGenerateLimiter, backupCodeVerifyLimiter } = require('../middleware/rateLimiter');
const { verifyBackupCodeBody, generateBackupCodesBody } = require('../validators/backupCodeSchemas');

const router = express.Router();

router.use(protect);

// GET  /backup-codes/status         → remaining count, no codes returned
router.get('/status', getStatus);

// POST /backup-codes/generate       → rate: 3/hour per user
router.post(
  '/generate',
  backupCodeGenerateLimiter,
  validate({ body: generateBackupCodesBody }),
  generateCodes
);

// POST /backup-codes/verify         → rate: 5/15 min per IP
router.post(
  '/verify',
  backupCodeVerifyLimiter,
  validate({ body: verifyBackupCodeBody }),
  verifyCode
);

// DELETE /backup-codes              → invalidate all without regenerating
router.delete('/', invalidateCodes);

module.exports = router;
