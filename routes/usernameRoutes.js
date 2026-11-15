const express = require("express");
const { checkAvailability, setUsername } = require("../controllers/usernameController");
const { protect } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const { usernameCheckLimiter, usernameWriteLimiter } = require("../middleware/rateLimiter");
const { setUsernameBody, checkUsernameQuery } = require("../validators/usernameSchemas");

const { revalidateOnSuccess } = require("../utils/frontendRevalidate");

const router = express.Router();

// GET /api/username/check?username=<name>
// Publicly accessible (rate limited by IP; authenticated users get a higher limit)
router.get(
  "/username/check",
  usernameCheckLimiter,
  validate({ query: checkUsernameQuery }),
  checkAvailability
);

// PATCH /api/username
// Requires authentication; per-user hourly write limit
router.patch(
  "/username",
  protect,
  usernameWriteLimiter,
  validate({ body: setUsernameBody }),
  revalidateOnSuccess((req) => [
    "users",
    "sitemap",
    `user:${String(req.user?._id)}`,
    `username:${req.user?.username}`,
    `bento:${req.user?.username}`,
    `username:${String(req.body?.username || "").toLowerCase()}`,
    `bento:${String(req.body?.username || "").toLowerCase()}`,
  ]),
  setUsername
);

module.exports = router;
