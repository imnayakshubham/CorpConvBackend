const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { createFeedback } = require("../controllers/feedbackController");

const router = express.Router();

router.route("/").post(protect, createFeedback);

module.exports = router;
