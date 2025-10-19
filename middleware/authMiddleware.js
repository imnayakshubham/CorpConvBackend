const asyncHandler = require("express-async-handler");
const { tokenkeyName, cookieOptions, authCookieNames, betterAuthSessionCookie } = require("../constants/index.js");
const { validateJwtAndGetUser, extractTokenFromExpress } = require("../utils/jwtAuth");
const { getAuth } = require("../config/auth.js");
const User = require("../models/userModel");

const isProd = process.env.APP_ENV === 'PROD';

/**
 * Clear all authentication cookies
 *
 * Primary: Better Auth session cookie
 * Legacy: JWT tokens (for backward compatibility)
 *
 * @param {Object} res - Express response object
 */
const clearAuthCookies = (res) => {
  const clearOptions = {
    ...cookieOptions,
    maxAge: 0
  };

  // Clear Better Auth session (primary authentication)
  res.clearCookie(authCookieNames.betterAuthSession, clearOptions);

  // Clear legacy JWT cookies (for backward compatibility)
  res.clearCookie(authCookieNames.token, clearOptions);
  res.clearCookie(authCookieNames.refreshToken, clearOptions);

  // Clear authentication flag
  res.clearCookie(authCookieNames.isAuthenticated, {
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
    domain: isProd ? undefined : 'localhost'
  });
};

/**
 * Authentication Middleware - Protects routes requiring authentication
 *
 * AUTHENTICATION FLOW (Better Auth - Primary):
 * 1. Check for Better Auth session cookie
 * 2. Validate session with Better Auth
 * 3. Extract user ID from session
 * 4. Fetch user data from MongoDB
 * 5. Attach user to req.user
 *
 * FALLBACK (Legacy JWT - for backward compatibility):
 * If Better Auth session not found, try JWT validation
 *
 * This ensures:
 * - Better Auth is the primary authentication system
 * - User data is always fresh from database
 * - Revoked users are immediately blocked
 */
const protect = asyncHandler(async (req, res, next) => {
  // Try Better Auth session first (primary auth method)
  const betterAuthSession = req.cookies?.['better-auth.session_token'];

  if (betterAuthSession) {
    try {
      const auth = getAuth();
      const session = await auth.api.getSession({ headers: req.headers });

      if (session && session.user) {
        // Fetch full user data from database
        const user = await User.findOne({ _id: session.user.id, access: true });

        if (!user) {
          clearAuthCookies(res);
          return res.status(401).send({ error: 'Unauthorized', message: 'User not found or access revoked' });
        }

        req.user = user;
        return next();
      }
    } catch (error) {
      console.log('Better Auth validation error:', error);
      // Fall through to JWT check
    }
  }

  // Fallback: Try JWT token (legacy auth for backward compatibility)
  const jwtToken = extractTokenFromExpress(req);

  if (!jwtToken) {
    clearAuthCookies(res);
    return res.status(401).send({ error: 'Unauthorized', message: 'No valid session found' });
  }

  try {
    // Validate JWT and fetch user from database
    const { user } = await validateJwtAndGetUser(jwtToken);
    req.user = user;
    next();

  } catch (error) {
    console.log('JWT validation error:', error);
    clearAuthCookies(res);

    if (error.name === 'TokenExpiredError') {
      return res.status(401).send({ error: 'TokenExpiredError', message: 'Session expired' });
    }

    return res.status(401).send({ error: 'Invalid token' });
  }
});

// Admin middleware - checks if user has admin privileges
// Note: This assumes admin status is determined by email or a future isAdmin field
const admin = asyncHandler(async (req, res, next) => {
  if (!req.user) {
    res.status(401);
    throw new Error("User not authenticated");
  }

  // For now, we'll check if user email is in admin list
  // This can be enhanced later with a proper admin role system
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(email => email.trim());

  const isAdmin = adminEmails.includes(req.user.user_email_id) ||
    req.user.is_admin === true ||
    req.user.role === 'admin';

  if (!isAdmin) {
    res.status(403);
    throw new Error("Access denied. Admin privileges required.");
  }

  next();
});

module.exports = { protect, admin };
