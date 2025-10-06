const asyncHandler = require("express-async-handler");
const { tokenkeyName, cookieOptions } = require("../constants/index.js");
const { validateJwtAndGetUser, extractTokenFromExpress } = require("../utils/jwtAuth");

const isProd = process.env.APP_ENV === 'PROD';

/**
 * Clear all authentication cookies (access token, refresh token, isAuthenticated flag)
 * @param {Object} res - Express response object
 */
const clearAuthCookies = (res) => {
  const clearOptions = {
    ...cookieOptions,
    maxAge: 0
  };

  res.clearCookie(tokenkeyName, clearOptions);
  res.clearCookie(`${tokenkeyName}:refresh`, clearOptions);
  res.clearCookie('isAuthenticated', {
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
    domain: isProd ? undefined : 'localhost'
  });
};

/**
 * Authentication Middleware - Protects routes requiring authentication
 *
 * SECURITY FLOW:
 * 1. Extract minimal JWT token (contains only user ID: { id: userId })
 * 2. Verify token signature and expiration
 * 3. Fetch complete user data from MongoDB database (trusted source)
 * 4. Attach user object to req.user for use in route handlers
 *
 * This ensures that:
 * - Tokens are minimal (only user ID, no sensitive data)
 * - User data is always fresh from database
 * - Revoked users are immediately blocked
 * - No sensitive data is exposed in the token payload
 */
const protect = asyncHandler(async (req, res, next) => {
  const token = extractTokenFromExpress(req);

  if (!token) {
    clearAuthCookies(res);
    return res.status(401).send({ error: 'Unauthorized', message: 'No token provided' });
  }

  try {
    // Validate JWT and fetch user from database using shared utility
    // This ensures user data is always current and access can be revoked
    const { user } = await validateJwtAndGetUser(token);

    req.user = user;
    next();

  } catch (error) {
    console.log(error);
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
