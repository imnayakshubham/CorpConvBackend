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

module.exports = { protect };
