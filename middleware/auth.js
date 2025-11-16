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
  const { findBetterAuthSessionCookie, projection } = require('../constants');
  const { getAuth } = require("../config/auth.js");
  const { User } = require('../models/userModel');

  try {
    // Check for session cookie
    const sessionToken = findBetterAuthSessionCookie(req.cookies);
    if (sessionToken) {
      try {
        const auth = getAuth();
        const session = await auth.api.getSession({ headers: req.headers });

        if (session && session.user) {
          // Fetch full user data from database
          const user = await User.findOne(
            { _id: session.user._id },
            projection // Use same projection as protect middleware
          );

          if (user && user.access !== false) {
            req.user = user; // Attach user to request
          }
        }
      } catch (authError) {
        // Authentication failed, but that's OK for optional auth
        console.log('Optional auth - session validation failed:', authError.message);
      }
    }

    // Always continue, even if authentication failed
    next();
  } catch (error) {
    // Unexpected error, but still continue for optional auth
    console.error('Optional auth middleware error:', error);
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
