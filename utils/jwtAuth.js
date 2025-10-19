const jwt = require("jsonwebtoken");
const { User } = require("../models/userModel");
const { tokenkeyName, projection, betterAuthSessionCookie } = require("../constants");
const logger = require("./logger");

/**
 * Validates JWT token and fetches user from database
 *
 * This is the core authentication logic shared by both Express middleware
 * and Better-auth plugin. It ensures consistent validation across the app.
 *
 * @param {string} token - JWT token to validate
 * @returns {Promise<{user: Object, decoded: Object}>} User object and decoded JWT payload
 * @throws {Error} TokenExpiredError, JsonWebTokenError, or USER_NOT_FOUND/NO_TOKEN errors
 */
async function validateJwtAndGetUser(token) {
  if (!token) {
    throw new Error('NO_TOKEN');
  }

  // Verify JWT signature and expiration (throws TokenExpiredError/JsonWebTokenError)
  const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);

  // Fetch user with projection and access check
  // This ensures user data is always fresh and access can be revoked
  const user = await User.findOne({ _id: decoded._id, access: true }, projection);

  if (!user) {
    logger.warn(`User validation failed for ID: ${decoded._id}`);
    throw new Error('USER_NOT_FOUND');
  }

  return { user, decoded };
}

/**
 * Extract JWT token from Express request
 * Checks both Authorization header (as 'token') and cookies
 *
 * @param {Object} req - Express request object
 * @returns {string|null} JWT token or null if not found
 */
function extractTokenFromExpress(req) {
  return req.headers.token || req.cookies?.[tokenkeyName];
}

/**
 * Extract Better Auth session token from Better-auth context
 * Parses cookie header to find the Better Auth session token
 *
 * @param {Object} ctx - Better-auth context object
 * @returns {string|null} Better Auth session token or null if not found
 */
function extractTokenFromBetterAuth(ctx) {
  const cookieHeader = ctx.request.headers.get("cookie");
  if (!cookieHeader) return null;

  return cookieHeader
    .split("; ")
    .find(c => c.startsWith(`${betterAuthSessionCookie}=`))
    ?.split("=")[1];
}

module.exports = {
  validateJwtAndGetUser,
  extractTokenFromExpress,
  extractTokenFromBetterAuth
};
