const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// ---------------------------------------------------------------------------
// Shared handler factory  - sets Retry-After + legacy X-RateLimit-* headers
// alongside the standardHeaders (RateLimit-* per RFC 9110) so that clients
// reading either header style get correct reset information.
// ---------------------------------------------------------------------------
function buildHandler(message) {
  return (req, res, _next, options) => {
    const resetMs = req.rateLimit?.resetTime?.getTime?.() ?? Date.now() + options.windowMs;
    const retrySec = Math.max(0, Math.ceil((resetMs - Date.now()) / 1000));
    const resetSec = Math.ceil(resetMs / 1000);

    res.setHeader('Retry-After', retrySec);
    res.setHeader('X-RateLimit-Limit', options.max);
    res.setHeader('X-RateLimit-Remaining', 0);
    res.setHeader('X-RateLimit-Reset', resetSec);

    res.status(options.statusCode ?? 429).json({
      status: 'Failed',
      message,
      data: null,
    });
  };
}

// ---------------------------------------------------------------------------
// Windows and maxima  - all configurable via environment variables.
// Defaults are conservative production-safe values.
// See hushworkbackend/.env.example for the full list.
// ---------------------------------------------------------------------------
const GLOBAL_MAX           = parseInt(process.env.RATE_LIMIT_GLOBAL_MAX            ?? '100', 10);
const AUTH_MAX             = parseInt(process.env.RATE_LIMIT_AUTH_MAX               ?? '10',  10);
const UPLOAD_MAX           = parseInt(process.env.RATE_LIMIT_UPLOAD_MAX             ?? '20',  10);
const SUBMISSION_MAX       = parseInt(process.env.RATE_LIMIT_SUBMISSION_MAX         ?? '5',   10);
const TRACKING_MAX         = parseInt(process.env.RATE_LIMIT_TRACKING_MAX           ?? '60',  10);
const WRITE_MAX            = parseInt(process.env.RATE_LIMIT_WRITE_MAX              ?? '30',  10);
const ADMIN_MAX            = parseInt(process.env.RATE_LIMIT_ADMIN_MAX              ?? '20',  10);
const USERNAME_CHECK_MAX   = parseInt(process.env.RATE_LIMIT_USERNAME_CHECK_MAX     ?? '30',  10);
const USERNAME_WRITE_MAX   = parseInt(process.env.RATE_LIMIT_USERNAME_WRITE_MAX     ?? '5',   10);

// ---------------------------------------------------------------------------
// NOTE: Redis-backed rate store upgrade path
// Install `rate-limit-redis` and pass the existing Upstash client:
//   const RedisStore = require('rate-limit-redis');
//   store: new RedisStore({ sendCommand: (...args) => redisClient.call(...args) })
// Add `store` to each limiter below to enable distributed rate limiting across
// multiple server instances without in-memory state drift.
// ---------------------------------------------------------------------------

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: GLOBAL_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildHandler('Too many requests, please try again later.'),
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildHandler('Too many authentication attempts, please try again later.'),
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: UPLOAD_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildHandler('Too many upload requests, please try again later.'),
});

const trackingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: TRACKING_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildHandler('Too many tracking requests, please try again later.'),
});

const submissionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: SUBMISSION_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildHandler('Too many submissions, please try again later.'),
});

// Per-user write limiter  - MUST be placed AFTER protect middleware in routes
// so req.user is populated for the keyGenerator. Falls back to IP when unauthenticated.
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: WRITE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?._id?.toString() || ipKeyGenerator(req),
  handler: buildHandler('Too many write requests, please slow down.'),
});

// Admin endpoints  - stricter per-IP limit.
// Place AFTER protect + superAdmin middleware in route definitions.
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: ADMIN_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildHandler('Too many admin requests, please try again later.'),
});

// Username availability check  - 30 req/min per IP (env-configurable)
const usernameCheckLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: USERNAME_CHECK_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildHandler('Too many username check requests, please try again later.'),
});

// Username set/update  - 5 attempts per hour per authenticated user
const usernameWriteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: USERNAME_WRITE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?._id?.toString() || ipKeyGenerator(req),
  handler: buildHandler('Too many username change attempts, please try again later.'),
});

// Secondary email OTP send  - 3 requests / 15 min per authenticated user
const emailOtpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_EMAIL_OTP_SEND_MAX ?? '3', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?._id?.toString() || ipKeyGenerator(req),
  handler: buildHandler('Too many verification code requests. Please wait 15 minutes.'),
});

// Secondary email OTP verify  - 5 attempts / 15 min per authenticated user
const emailOtpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_EMAIL_OTP_VERIFY_MAX ?? '5', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?._id?.toString() || ipKeyGenerator(req),
  handler: buildHandler('Too many OTP verification attempts. Please request a new code.'),
});

// Backup code generation  - 3 / hour per authenticated user
const backupCodeGenerateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_BACKUP_CODE_GENERATE_MAX ?? '3', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?._id?.toString() || ipKeyGenerator(req),
  handler: buildHandler('Too many backup code generation requests. Try again in an hour.'),
});

// Backup code verification  - 5 attempts / 15 min per IP
const backupCodeVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_BACKUP_CODE_VERIFY_MAX ?? '5', 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildHandler('Too many backup code attempts. Please wait before trying again.'),
});

module.exports = {
  globalLimiter,
  authLimiter,
  uploadLimiter,
  trackingLimiter,
  submissionLimiter,
  writeLimiter,
  adminLimiter,
  usernameCheckLimiter,
  usernameWriteLimiter,
  emailOtpSendLimiter,
  emailOtpVerifyLimiter,
  backupCodeGenerateLimiter,
  backupCodeVerifyLimiter,
};
