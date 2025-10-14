/**
 * Auth Middleware Wrapper
 *
 * This file provides authentication middleware wrappers for the forms/surveys API.
 * It maps to the existing authMiddleware.js to maintain naming convention compatibility.
 */

const { protect, admin } = require('./authMiddleware');

/**
 * authenticateToken - Requires user to be authenticated
 * Maps to existing 'protect' middleware
 */
const authenticateToken = protect;

/**
 * optionalAuth - Makes authentication optional for public routes
 * Attempts to authenticate user if token is present, but doesn't block if absent
 */
const optionalAuth = async (req, res, next) => {
  try {
    // Try to authenticate, but don't block if it fails
    await protect(req, res, (err) => {
      if (err) {
        // Clear any error and continue without authentication
        req.user = null;
      }
      next();
    });
  } catch (error) {
    // Authentication failed but that's OK for optional auth
    req.user = null;
    next();
  }
};

module.exports = {
  authenticateToken,
  optionalAuth,
  admin, // Re-export admin middleware
  protect // Re-export protect for backward compatibility
};
