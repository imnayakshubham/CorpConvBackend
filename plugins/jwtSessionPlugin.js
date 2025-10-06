const { createAuthEndpoint } = require("better-auth/api");
const { validateJwtAndGetUser, extractTokenFromBetterAuth } = require("../utils/jwtAuth");
const logger = require("../utils/logger");

/**
 * JWT Session Plugin for Better Auth
 *
 * Overrides the default get-session endpoint to read from JWT cookie
 * instead of querying MongoDB session table.
 *
 * This allows better-auth to work with existing JWT authentication
 * without requiring session records in the database.
 */
const jwtSessionPlugin = () => {
  return {
    id: "jwt-session",
    endpoints: {
      // Override default /get-session endpoint
      getSession: createAuthEndpoint("/get-session", {
        method: "GET"
      }, async (ctx) => {
        try {
          // Extract JWT token from cookies using shared utility
          const token = extractTokenFromBetterAuth(ctx);

          if (!token) {
            return ctx.json({ user: null, session: null });
          }

          // Validate JWT and fetch user from database using shared utility
          const { user, decoded } = await validateJwtAndGetUser(token);

          // Return better-auth compatible session format
          return ctx.json({
            user: user,
            session: {
              user_id: user._id.toString(),
              expiresAt: new Date(decoded.exp * 1000), // JWT exp is in seconds
              token: token
            }
          });

        } catch (error) {
          if (error.name === 'TokenExpiredError') {
            logger.debug("JWT token expired");
          } else if (error.name === 'JsonWebTokenError') {
            logger.warn(`Invalid JWT token: ${error.message}`);
          } else {
            logger.error("Error in JWT session plugin:", error);
          }

          return ctx.json({ user: null, session: null });
        }
      })
    }
  };
};

module.exports = { jwtSessionPlugin };
