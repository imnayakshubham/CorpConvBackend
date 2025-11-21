const getRedisInstance = require("../../redisClient/redisClient");

/**
 * @typedef {Object} RateLimitSettings
 * @property {boolean} enabled
 * @property {number} maxSubmissions
 * @property {number} windowMs - Time window in milliseconds
 */

/**
 * @typedef {Object} FormRateLimitSettings
 * @property {boolean} enabled
 * @property {number} maxSubmissions
 * @property {number} timeWindow - Time window in minutes
 * @property {number} blockDuration - Block duration in minutes
 * @property {string} message - Error message when rate limit is exceeded
 */

/**
 * @typedef {Object} RateLimitResult
 * @property {boolean} success - Whether the request is allowed
 * @property {number} limit - Maximum allowed requests
 * @property {number} remaining - Remaining requests in the window
 * @property {number} reset - Timestamp when the limit resets (ms)
 * @property {string} [message] - Error message if rate limited
 */

let redis = null;

/**
 * Get or create Redis client instance
 * @returns {import('ioredis').Redis}
 */
function getRedisClient() {
  if (!redis) {
    redis = getRedisInstance();
  }
  return redis;
}

/**
 * Implement sliding window rate limiting using ioredis
 * @param {string} key - Redis key for rate limiting
 * @param {number} limit - Maximum number of requests
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Promise<RateLimitResult>}
 */
async function checkRateLimitInternal(key, limit, windowMs) {
  const redis = getRedisClient();
  const now = Date.now();
  const windowStart = now - windowMs;

  try {
    // Use Redis pipeline for atomic operations
    const pipeline = redis.pipeline();

    // Remove old entries outside the time window
    pipeline.zremrangebyscore(key, 0, windowStart);

    // Count current entries in the window
    pipeline.zcard(key);

    // Add current request
    pipeline.zadd(key, now, `${now}-${Math.random()}`);

    // Set expiration
    pipeline.expire(key, Math.ceil(windowMs / 1000));

    const results = await pipeline.exec();

    // results[1] is the ZCARD result (count before adding current request)
    const currentCount = results[1][1];

    const allowed = currentCount < limit;
    const remaining = Math.max(0, limit - currentCount - 1);

    // Calculate reset time (end of current window)
    const reset = now + windowMs;

    return {
      success: allowed,
      limit,
      remaining: allowed ? remaining : 0,
      reset,
    };
  } catch (error) {
    console.error("Error checking rate limit:", error);
    // On error, allow the request to prevent blocking users
    return {
      success: true,
      limit,
      remaining: limit,
      reset: now + windowMs,
    };
  }
}

/**
 * Check if an identifier has exceeded the rate limit
 * @param {string} identifier - Unique identifier (e.g., IP address, user ID)
 * @param {RateLimitSettings} settings
 * @returns {Promise<RateLimitResult>}
 */
async function checkRateLimit(identifier, settings) {
  if (!settings.enabled) {
    return {
      success: true,
      limit: 0,
      remaining: 0,
      reset: 0,
    };
  }

  const key = `ratelimit:${identifier}`;
  return checkRateLimitInternal(key, settings.maxSubmissions, settings.windowMs);
}

/**
 * Check custom rate limit with custom prefix
 * @param {string} identifier - Unique identifier
 * @param {RateLimitSettings} settings
 * @param {string} prefix - Custom prefix for the rate limiter
 * @returns {Promise<RateLimitResult>}
 */
async function checkCustomRateLimit(identifier, settings, prefix = "ratelimit") {
  if (!settings.enabled) {
    return {
      success: true,
      limit: 0,
      remaining: 0,
      reset: 0,
    };
  }

  const key = `${prefix}:${identifier}`;
  return checkRateLimitInternal(key, settings.maxSubmissions, settings.windowMs);
}

/**
 * Check form-specific rate limit
 * @param {string} ipAddress - IP address of the requester
 * @param {string} formId - Form ID
 * @param {FormRateLimitSettings} settings
 * @returns {Promise<RateLimitResult & {message: string}>}
 */
async function checkFormRateLimit(ipAddress, formId, settings) {
  if (!settings.enabled) {
    return {
      success: true,
      limit: 0,
      remaining: 0,
      reset: 0,
      message: "",
    };
  }

  const key = `form-ratelimit:${formId}:${ipAddress}`;
  const windowMs = settings.timeWindow * 60 * 1000; // Convert minutes to milliseconds

  const result = await checkRateLimitInternal(
    key,
    settings.maxSubmissions,
    windowMs
  );

  return {
    ...result,
    message: result.success ? "" : settings.message,
  };
}

module.exports = {
  checkRateLimit,
  checkCustomRateLimit,
  checkFormRateLimit,
  getRedisClient,
};
