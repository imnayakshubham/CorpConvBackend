const {
  checkDuplicateSubmission,
  recordSubmission,
  generateIdentifier,
  extractEmailFromSubmissionData,
  formatTimeRemaining,
} = require("../utils/forms/duplicate-prevention");
const logger = require("../utils/logger");

/**
 * Express middleware to prevent duplicate form submissions
 *
 * @param {Object} settings - Duplicate prevention settings
 * @param {boolean} settings.enabled - Whether duplicate prevention is enabled
 * @param {"ip"|"email"|"session"|"combined"} settings.strategy - Detection strategy
 * @param {"time-based"|"one-time"} settings.mode - Prevention mode
 * @param {number} settings.timeWindow - Time window in minutes (for time-based mode)
 * @param {string} settings.message - Error message when duplicate is detected
 * @param {boolean} [settings.allowOverride] - Allow manual override
 * @param {number} [settings.maxAttempts] - Maximum attempts (for time-based mode)
 * @returns {Function} Express middleware function
 *
 * @example
 * // One-time submission (no duplicate allowed)
 * router.post('/:id/submit', duplicatePreventionMiddleware({
 *   enabled: true,
 *   strategy: 'combined',
 *   mode: 'one-time',
 *   message: 'You have already submitted this form.'
 * }), async (req, res) => { ... });
 *
 * // Time-based with multiple attempts
 * router.post('/:id/submit', duplicatePreventionMiddleware({
 *   enabled: true,
 *   strategy: 'ip',
 *   mode: 'time-based',
 *   timeWindow: 60,
 *   maxAttempts: 3,
 *   message: 'You can only submit 3 times per hour.'
 * }), async (req, res) => { ... });
 */
function duplicatePreventionMiddleware(settings) {
  return async (req, res, next) => {
    if (!settings.enabled) {
      return next();
    }

    try {
      // Get form ID from params
      const formId = req.params._id;
      if (!formId) {
        logger.warn(
          "Duplicate prevention middleware: No form ID in request params"
        );
        return next();
      }

      // Get IP address
      const ipAddress = req.ip || req.connection.remoteAddress || "unknown";

      // Get session ID from headers or body
      const sessionId =
        req.body.sessionId || req.headers["x-session-id"] || undefined;

      // Try to extract email from submission data
      const email = extractEmailFromSubmissionData(req.body.data || {});

      // Generate unique identifier based on strategy
      const identifier = generateIdentifier(
        settings.strategy,
        ipAddress,
        email,
        sessionId
      );

      // Check for duplicate submission
      const duplicateCheck = await checkDuplicateSubmission(
        formId,
        identifier,
        settings
      );

      if (duplicateCheck.isDuplicate) {
        // Duplicate submission detected
        const response = {
          success: false,
          error: "Duplicate submission",
          message: duplicateCheck.message,
        };

        // Add time remaining info for time-based mode
        if (duplicateCheck.timeRemaining) {
          response.timeRemaining = formatTimeRemaining(
            duplicateCheck.timeRemaining
          );
          response.timeRemainingSeconds = duplicateCheck.timeRemaining;
        }

        // Add attempts remaining info
        if (typeof duplicateCheck.attemptsRemaining === "number") {
          response.attemptsRemaining = duplicateCheck.attemptsRemaining;
        }

        return res.status(400).json(response);
      }

      // Not a duplicate - attach recordSubmission function to req
      // so the route handler can call it after successful submission
      req.recordDuplicatePrevention = async () => {
        await recordSubmission(formId, identifier, settings);
      };

      next();
    } catch (error) {
      logger.error("Error in duplicate prevention middleware:", error);
      // If duplicate prevention fails, allow the request to proceed
      // This prevents blocking users due to Redis/network issues
      next();
    }
  };
}

/**
 * Helper middleware to automatically record submission after route handler succeeds
 * Use this AFTER your main route handler if you want automatic recording
 *
 * @example
 * router.post('/:id/submit',
 *   duplicatePreventionMiddleware(settings),
 *   async (req, res) => {
 *     // Your submission logic
 *     res.json({ success: true });
 *   },
 *   autoRecordSubmission  // <-- Add this after route handler
 * );
 */
async function autoRecordSubmission(req, res, next) {
  // Only record if response was successful (2xx status)
  if (res.statusCode >= 200 && res.statusCode < 300) {
    if (typeof req.recordDuplicatePrevention === "function") {
      try {
        await req.recordDuplicatePrevention();
      } catch (error) {
        logger.error("Error auto-recording submission:", error);
      }
    }
  }
  next();
}

module.exports = {
  duplicatePreventionMiddleware,
  autoRecordSubmission,
};
