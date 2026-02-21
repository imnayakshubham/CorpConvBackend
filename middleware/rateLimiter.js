const rateLimit = require('express-rate-limit');

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'Failed',
    message: 'Too many requests, please try again later.',
    data: null,
  },
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'Failed',
    message: 'Too many authentication attempts, please try again later.',
    data: null,
  },
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'Failed',
    message: 'Too many upload requests, please try again later.',
    data: null,
  },
});

const trackingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'Failed',
    message: 'Too many tracking requests, please try again later.',
    data: null,
  },
});

const submissionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'Failed',
    message: 'Too many submissions, please try again later.',
    data: null,
  },
});

module.exports = {
  globalLimiter,
  authLimiter,
  uploadLimiter,
  trackingLimiter,
  submissionLimiter,
};
