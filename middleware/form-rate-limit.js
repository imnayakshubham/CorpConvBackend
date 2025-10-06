const { checkFormRateLimit } = require("../utils/forms/rate-limit");
const logger = require("../utils/logger");

/**
 * Express middleware to apply Redis-based rate limiting for form submissions
 *
 * @param {Object} settings - Rate limit settings
 * @param {boolean} settings.enabled - Whether rate limiting is enabled
 * @param {number} settings.maxSubmissions - Maximum submissions allowed
 * @param {number} settings.timeWindow - Time window in minutes
 * @param {number} settings.blockDuration - Block duration in minutes
 * @param {string} settings.message - Error message when rate limit is exceeded
 * @returns {Function} Express middleware function
 *
 * @example
 * // Apply to a specific route
 * router.post('/:id/submit', formRateLimitMiddleware({
 *   enabled: true,
 *   maxSubmissions: 5,
 *   timeWindow: 10,
 *   blockDuration: 30,
 *   message: 'Too many submissions. Please try again later.'
 * }), async (req, res) => { ... });
 */
function formRateLimitMiddleware(settings) {
  return async (req, res, next) => {
    if (!settings.enabled) {
      return next();
    }

    try {
      // Get form ID from params
      const formId = req.params.id;
      if (!formId) {
        logger.warn("Form rate limit middleware: No form ID in request params");
        return next();
      }

      // Get IP address
      const ipAddress = req.ip || req.connection.remoteAddress || "unknown";

      // Check rate limit
      const result = await checkFormRateLimit(ipAddress, formId, settings);

      if (!result.success) {
        // Rate limit exceeded
        return res.status(429).json({
          success: false,
          error: "Rate limit exceeded",
          message: result.message,
          retryAfter: result.reset ? Math.ceil(result.reset / 1000) : undefined,
        });
      }

      // Add rate limit info to response headers
      res.setHeader("X-RateLimit-Limit", result.limit);
      res.setHeader("X-RateLimit-Remaining", result.remaining);
      if (result.reset) {
        res.setHeader("X-RateLimit-Reset", Math.ceil(result.reset / 1000));
      }

      next();
    } catch (error) {
      logger.error("Error in form rate limit middleware:", error);
      // If rate limiting fails, allow the request to proceed
      // This prevents blocking users due to Redis/network issues
      next();
    }
  };
}

module.exports = {
  formRateLimitMiddleware,
};
