const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const { writeLimiter, submissionLimiter } = require("../middleware/rateLimiter");
const {
  createRoom,
  browseRooms,
  myConversations,
  joinRoom,
  leaveRoom,
  searchConversations,
  toggleStar,
  inviteToRoom,
  updateRoom,
  getRoomMembers,
  banMember,
} = require("../controllers/conversationController");
const {
  createRoomBody,
  joinRoomBody,
  roomIdParam,
  inviteBody,
  updateRoomBody,
} = require("../validators/conversationSchemas");

const router = express.Router();

// Static routes before /:id to avoid conflicts.
router.get("/my", protect, myConversations);
router.get("/browse", protect, browseRooms);
router.get("/search", protect, searchConversations);
router.get("/:id/members", protect, validate({ params: roomIdParam }), getRoomMembers);
router.post("/room", protect, writeLimiter, validate({ body: createRoomBody }), createRoom);

router.post("/:id/join", protect, submissionLimiter, validate({ params: roomIdParam, body: joinRoomBody }), joinRoom);
router.post("/:id/leave", protect, validate({ params: roomIdParam }), leaveRoom);
router.post("/:id/star", protect, validate({ params: roomIdParam }), toggleStar);
router.post("/:id/invite", protect, writeLimiter, validate({ params: roomIdParam, body: inviteBody }), inviteToRoom);
router.post("/:id/ban", protect, writeLimiter, validate({ params: roomIdParam, body: inviteBody }), banMember);
router.patch("/:id", protect, writeLimiter, validate({ params: roomIdParam, body: updateRoomBody }), updateRoom);

module.exports = router;
