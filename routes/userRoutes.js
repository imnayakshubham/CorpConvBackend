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
  getUserInfo,
  updateUserProfileDetails,
  addProfileItem, deleteProfileItem, updateProfileItem,
  getProfile,
  updateLayouts
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
router.route("/update-profile-details").post(protect, updateUserProfileDetails);

router.route("/send-follow-request").post(protect, sendFollowRequest);
router.route("/accept-follow-request").post(protect, acceptFollowRequest);
router.route("/reject-follow-request").post(protect, rejectFollowRequest);


router
  .route('/:user_id/profile')
  .get(protect, getProfile);

// Route: Add item or update layouts
router.route('/:user_id/profile/items').post(protect, addProfileItem);

// Route: Update or delete a specific item
router
  .route('/:user_id/profile/items/:item_id')
  .put(protect, updateProfileItem)
  .delete(protect, deleteProfileItem);

// Route: Update layouts (all breakpoints)
router
  .route('/user/:user_id/profile/layouts')
  .put(protect, updateLayouts);

module.exports = router;
