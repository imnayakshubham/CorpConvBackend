const express = require("express");
const {
  allMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  addReaction,
  markDelivered,
  markRead,
} = require("../controllers/messageControllers");
const { protect } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const {
  sendMessageBody,
  chatIdParam,
  messageIdParam,
  editMessageBody,
  reactionBody,
  deliveredBody,
} = require("../validators/messageSchemas");

const router = express.Router();

// Must be before /:id routes to avoid conflict
router.patch("/delivered", protect, validate({ body: deliveredBody }), markDelivered);
router.patch("/read", protect, markRead);

router.get("/:chatId", protect, validate({ params: chatIdParam }), allMessages);
router.post("/", protect, validate({ body: sendMessageBody }), sendMessage);
router.patch("/:id", protect, validate({ params: messageIdParam, body: editMessageBody }), editMessage);
router.delete("/:id", protect, validate({ params: messageIdParam }), deleteMessage);
router.post("/:id/react", protect, validate({ params: messageIdParam, body: reactionBody }), addReaction);

module.exports = router;
