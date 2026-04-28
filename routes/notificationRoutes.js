const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const { notificationIdParam, paginationQuery } = require("../validators/notificationSchemas");
const {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllRead,
} = require("../controllers/notificationController");

const router = express.Router();

router.get("/", protect, validate({ query: paginationQuery }), getNotifications);
router.get("/unread-count", protect, getUnreadCount);
router.patch("/read-all", protect, markAllRead);
router.patch("/:id/read", protect, validate({ params: notificationIdParam }), markAsRead);

module.exports = router;
