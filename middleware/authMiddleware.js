const jwt = require("jsonwebtoken");
const User = require("../models/userModel.js");
const asyncHandler = require("express-async-handler");

const protect = asyncHandler(async (req, res, next) => {
  const token = req.headers.token

  if (!!token) {
    try {

      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
      const user = await User.findOne({ _id: decoded.id })
      if (user && user.access) {
        req.user = await User.findOne({ _id: decoded.id })
        next();
      } else {
        console.log("hello")
        return res.status(404).send({ error: 'User Not Found', message: 'User Not Found or User Access is Revoked' });
      }

    } catch (error) {

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

module.exports = { protect };
