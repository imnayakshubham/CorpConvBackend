const express = require("express");
const {
  createFeedback,
  getAllFeedback,
  getFeedback,
  updateFeedback,
  deleteFeedback,
  getFeedbackStats,
  voteFeedback,
  getMyFeedback
} = require("../controllers/feedbackController");
const { protect, admin } = require("../middleware/authMiddleware");

const router = express.Router();

// Public routes (with rate limiting handled in controller)
router.route("/")
  .post(createFeedback)  // Anyone can submit feedback
  .get(protect, admin, getAllFeedback);  // Only admins can view all feedback

// Statistics route (admin only)
router.route("/stats")
  .get(protect, admin, getFeedbackStats);

// My feedback route (authenticated users only)
router.route("/my")
  .get(protect, getMyFeedback);

// Individual feedback routes
router.route("/:id")
  .get(protect, getFeedback)  // User can view their own or admin can view any
  .put(protect, admin, updateFeedback)  // Only admins can update
  .delete(protect, admin, deleteFeedback);  // Only admins can delete

// Voting routes (authenticated users only)
router.route("/:id/vote")
  .post(protect, voteFeedback);

module.exports = router;