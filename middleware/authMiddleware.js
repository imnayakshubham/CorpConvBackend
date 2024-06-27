const jwt = require("jsonwebtoken");
const User = require("../models/userModel.js");
const asyncHandler = require("express-async-handler");

const protect = asyncHandler(async (req, res, next) => {
  const token = req.headers.token

  if (!!token) {
    try {

      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
      req.user = await User.findOne({ _id: decoded.id })
      next();
    } catch (error) {

      if (error.name === 'TokenExpiredError') {
        return res.status(401).send({ error: 'TokenExpiredError', message: 'Session expired' });
      }

      res.status(400).send({ error: 'Invalid token' });
    }
  }

  if (!token) {
    res.status(401);
    throw new Error("Not authorized, no token");
  }
});

module.exports = { protect };
