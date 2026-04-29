const express = require("express");
const {
  authUser,
  allUsers,
  logout,
  updateUserProfile,
  fetchUsers,
  sendFollowRequest,
  acceptFollowRequest,
  rejectFollowRequest,
  getfollowersList,
  getUserInfo,
  listUserSessions,
  revokeSession,
  revokeAllSessions,
  updateAvatarConfig,
  updateQRConfig,
  trackProfileView,
  getUserAnalytics,
  getUserByUsername,
  getChatUsers
} = require("../controllers/userControllers");
const { protect, optionalAuth } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const { authLimiter, trackingLimiter } = require("../middleware/rateLimiter");
const {
  authUserBody,
  updateUserProfileBody,
  fetchUsersBody,
  sendFollowRequestBody,
  acceptRejectFollowBody,
  revokeSessionBody,
  revokeAllSessionsBody,
  updateAvatarConfigBody,
  updateQRConfigBody,
  searchQuery,
  userIdParam,
} = require("../validators/userSchemas");

const secondaryEmailRoutes = require('./secondaryEmailRoutes');
const backupCodeRoutes = require('./backupCodeRoutes');

const router = express.Router();

router.route("/user").get(protect, validate({ query: searchQuery }), allUsers);
// Analytics routes (must be before /user/:id to avoid route conflict)
router.route("/user/analytics").get(protect, getUserAnalytics);
// Username lookup (must be before /user/:id to prevent "by-username" matching as an ID)
router.route("/user/by-username/:username").get(getUserByUsername);
router.route("/user/:id").get(validate({ params: userIdParam }), getUserInfo);
router.route("/followers").get(protect, validate({ query: searchQuery }), getfollowersList);
router.get("/chat-users", protect, getChatUsers);
router.post("/auth", authLimiter, validate({ body: authUserBody }), authUser);
router.route("/users").post(validate({ body: fetchUsersBody }), fetchUsers);
router.route("/logout").post(protect, logout);
router.route("/update-profile").post(protect, validate({ body: updateUserProfileBody }), updateUserProfile);

router.route("/send-follow-request").post(protect, validate({ body: sendFollowRequestBody }), sendFollowRequest);
router.route("/accept-follow-request").post(protect, validate({ body: acceptRejectFollowBody }), acceptFollowRequest);
router.route("/reject-follow-request").post(protect, validate({ body: acceptRejectFollowBody }), rejectFollowRequest);

// Session Management
router.route("/sessions").get(protect, listUserSessions);
router.route("/sessions/revoke").post(protect, validate({ body: revokeSessionBody }), revokeSession);
router.route("/sessions/revoke-all").post(protect, validate({ body: revokeAllSessionsBody }), revokeAllSessions);

// Avatar and QR Code Configuration
router.route("/update-avatar").post(protect, validate({ body: updateAvatarConfigBody }), updateAvatarConfig);
router.route("/update-qr-config").post(protect, validate({ body: updateQRConfigBody }), updateQRConfig);

// Profile view tracking
router.route("/track-profile-view/:id").post(optionalAuth, trackingLimiter, validate({ params: userIdParam }), trackProfileView);

// Secondary email management (validate, save, remove; OTP flow ready for future activation)
router.use('/secondary-email', secondaryEmailRoutes);

// Backup / recovery codes (MFA fallback)
router.use('/backup-codes', backupCodeRoutes);

module.exports = router;
