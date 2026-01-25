const jwt = require("jsonwebtoken");
const User = require("../models/userModel.js");
const asyncHandler = require("express-async-handler");
const { tokenkeyName, cookieOptions } = require("../constants/index.js");

const protect = asyncHandler(async (req, res, next) => {
  const token = req.headers.token;
  const { getAuth } = require("../utils/auth");

  // 1. Try Better Auth
  try {
    const auth = getAuth();
    if (auth) {
      const session = await auth.api.getSession({
        headers: req.headers,
      });


      if (session) {
        req.user = session.user;

        if (session.user) {
          const dbUser = await User.findById(session.user.id || session.user._id);
          if (dbUser && dbUser.access) {
            req.user = dbUser;
            return next();
          }
        }
      }
    }
  } catch (error) {
    console.log("Better Auth check failed, falling back to legacy token:", error.message);
  }

  // 2. Fallback to Legacy JWT Token
  if (!!token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
      const user = await User.findOne({ _id: decoded.id })

      if (user && user.access) {
        req.user = await User.findOne({ _id: decoded.id })
        return next();
      } else {
        res.clearCookie(tokenkeyName, cookieOptions);
        return res.status(401).send({ error: 'User Not Found', message: 'User Not Found or User Access is Revoked' });
      }

    } catch (error) {
      res.clearCookie(tokenkeyName, cookieOptions);
      if (error.name === 'TokenExpiredError') {
        return res.status(401).send({ error: 'TokenExpiredError', message: 'Session expired' });
      }

      return res.status(400).send({ error: 'Invalid token' });
    }
  }

  if (!token) {
    res.status(401);
    throw new Error("Not authorized");
  }
});

// Optional auth middleware - sets req.user if authenticated, but doesn't require it
const optionalAuth = asyncHandler(async (req, _res, next) => {
  const token = req.headers.token;
  const { getAuth } = require("../utils/auth");

  // 1. Try Better Auth
  try {
    const auth = getAuth();
    if (auth) {
      const session = await auth.api.getSession({
        headers: req.headers,
      });

      if (session && session.user) {
        const dbUser = await User.findById(session.user.id || session.user._id);
        if (dbUser && dbUser.access) {
          req.user = dbUser;
          return next();
        }
      }
    }
  } catch (error) {
    // Silent fail for optional auth
  }

  // 2. Fallback to Legacy JWT Token
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
      const user = await User.findOne({ _id: decoded.id });

      if (user && user.access) {
        req.user = user;
        return next();
      }
    } catch (error) {
      // Silent fail for optional auth
    }
  }

  // No auth, continue without user
  req.user = null;
  return next();
});

module.exports = { protect, optionalAuth };
