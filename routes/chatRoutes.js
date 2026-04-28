const express = require("express");
const {
  accessChat,
  fetchChats,
  createGroupChat,
  removeFromGroup,
  addToGroup,
  renameGroup,
  fetchMessageRequests,
  acceptRequest,
  rejectRequest,
} = require("../controllers/chatControllers");
const { protect } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const {
  accessChatBody,
  createGroupChatBody,
  renameGroupBody,
  groupMemberBody,
} = require("../validators/chatSchemas");

const router = express.Router();

router.route("/").post(protect, validate({ body: accessChatBody }), accessChat);
router.route("/chat-list").get(protect, fetchChats);

router.route("/group").post(protect, validate({ body: createGroupChatBody }), createGroupChat);
router.route("/rename").put(protect, validate({ body: renameGroupBody }), renameGroup);
router.route("/groupremove").put(protect, validate({ body: groupMemberBody }), removeFromGroup);
router.route("/groupadd").put(protect, validate({ body: groupMemberBody }), addToGroup);

router.route("/requests").get(protect, fetchMessageRequests);
router.route("/:chatId/accept").put(protect, acceptRequest);
router.route("/:chatId/reject").put(protect, rejectRequest);

module.exports = router;
