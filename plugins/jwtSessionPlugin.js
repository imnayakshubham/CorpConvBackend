const { createAuthEndpoint } = require("better-auth/api");
const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const { tokenkeyName, projection } = require("../constants");
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
          // Extract JWT token from cookies
          const cookieHeader = ctx.request.headers.get("cookie");
          if (!cookieHeader) {
            return ctx.json({ user: null, session: null });
          }

          const token = cookieHeader
            .split("; ")
            .find(c => c.startsWith(`${tokenkeyName}=`))
            ?.split("=")[1];

          if (!token) {
            return ctx.json({ user: null, session: null });
          }

          // Verify JWT token
          const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);

          // Fetch user from database with projection (ensures fresh data, only needed fields)
          const user = await User.findOne({ _id: decoded.id, access: true }, projection);

          if (!user) {
            logger.warn(`Session check failed for user ID: ${decoded.id}`);
            return ctx.json({ user: null, session: null });
          }

          // Return better-auth compatible session format
          return ctx.json({
            user: user,
            session: {
              userId: user._id.toString(),
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
