const jwt = require("jsonwebtoken");
const User = require("../models/userModel.js");
const asyncHandler = require("express-async-handler");
const { tokenkeyName, cookieOptions } = require("../constants/index.js");

const protect = asyncHandler(async (req, res, next) => {
  const token = req.headers.token || req.cookies?.[tokenkeyName]

  if (!token) {
    res.clearCookie(tokenkeyName);
    return res.status(401).send({ error: 'Unauthorized', message: 'No token provided' });
  }

  if (!!token) {
    try {

      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
      const user = await User.findOne({ _id: decoded.id })

      if (user && user.access) {
        req.user = await User.findOne({ _id: decoded.id })
        next();
      } else {
        res.clearCookie(tokenkeyName);
        return res.status(401).send({ error: 'User Not Found', message: 'User Not Found or User Access is Revoked' });
      }

    } catch (error) {
      console.log(error)
      res.clearCookie(tokenkeyName);
      if (error.name === 'TokenExpiredError') {
        return res.status(401).send({ error: 'TokenExpiredError', message: 'Session expired' });
      }

      return res.status(401).send({ error: 'Invalid token' });
    }
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

  const isAdmin = adminEmails.includes(req.user.email) ||
                  req.user.isAdmin === true ||
                  req.user.role === 'admin';

  if (!isAdmin) {
    res.status(403);
    throw new Error("Access denied. Admin privileges required.");
  }

  next();
});

module.exports = { protect, admin };
