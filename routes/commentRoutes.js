const express = require("express");

const { protect } = require("../middleware/authMiddleware");
const { postComments, postReplyComments, likeComment, deleteComment, getCommentReplies, getPostComments } = require("../controllers/commentController");

const router = express.Router();

router.route("/create").post(protect, postComments)
router.route("/reply").post(protect, postReplyComments)
router.route("/delete").post(protect, deleteComment)
router.route("/like").post(protect, likeComment)
router.route("/post/:post_id").get(getPostComments)
router.route("/replies/:comment_id").get(getCommentReplies)

// router.route("/bookmark").post(protect, bookMarkJob)
// router.route("/").get(fetchJobs)

module.exports = router;