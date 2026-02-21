const express = require("express");
const {
  allMessages,
  sendMessage,
} = require("../controllers/messageControllers");
const { protect } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const { sendMessageBody, chatIdParam } = require("../validators/messageSchemas");

const router = express.Router();

router.route("/:chatId").get(protect, validate({ params: chatIdParam }), allMessages);
router.route("/").post(protect, validate({ body: sendMessageBody }), sendMessage);

module.exports = router;
