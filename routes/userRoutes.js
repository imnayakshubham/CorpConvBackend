const express = require("express");
const {
  registerUser,
  authUser,
  allUsers,
  logout,
  updateUserProfile,
  fetchUsers,
  sendFollowRequest,
  acceptFollowRequest,
  rejectFollowRequest,
  getfollowersList,
  getUserInfo
} = require("../controllers/userControllers");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.route("/user").get(protect, allUsers);
router.route("/user/:id").get(getUserInfo)
router.route("/followers").get(protect, getfollowersList);
router.post("/auth", authUser);
router.route("/users").post(fetchUsers);
router.route("/logout").post(protect, logout)
router.route("/update-profile").post(protect, updateUserProfile);


router.route("/send-follow-request").post(protect, sendFollowRequest);
router.route("/accept-follow-request").post(protect, acceptFollowRequest);
router.route("/reject-follow-request").post(protect, rejectFollowRequest);


module.exports = router;
