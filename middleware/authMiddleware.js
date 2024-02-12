const jwt = require("jsonwebtoken");
const User = require("../models/userModel.js");
const asyncHandler = require("express-async-handler");

const protect = asyncHandler(async (req, res, next) => {
  const token = req.headers.token

  if (!!token) {
    try {

      //decodes token id
      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
      req.user = await User.findOne({ _id: decoded.id })
      next();
    } catch (error) {
      res.status(401);
      throw new Error("Not authorized, token failed");
    }
  }

  if (!token) {
    res.status(401);
    throw new Error("Not authorized, no token");
  }
});

module.exports = { protect };
