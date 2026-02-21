const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { createFeedback } = require("../controllers/feedbackController");
const validate = require("../middleware/validate");
const { createFeedbackBody } = require("../validators/feedbackSchemas");

const router = express.Router();

router.route("/").post(protect, validate({ body: createFeedbackBody }), createFeedback);

module.exports = router;
