const express = require("express");

const { protect } = require("../middleware/authMiddleware");
const { postComments, postReplyComments, likeComment, downvoteComment, awardComment, shareComment, deleteComment, getCommentReplies, getCommentsByPostId } = require("../controllers/commentController");

const router = express.Router();

router.route("/create").post(protect, postComments)
router.route("/reply").post(protect, postReplyComments)
router.route("/delete").post(protect, deleteComment)
router.route("/like").post(protect, likeComment)
router.route("/downvote").post(protect, downvoteComment)
router.route("/award").post(protect, awardComment)
router.route("/share").post(protect, shareComment)
router.route("/post/:post_id").get(getCommentsByPostId)
router.route(`/:post_id/comment/:comment_id`).get(getCommentReplies)

// router.route("/bookmark").post(protect, bookMarkJob)
// router.route("/").get(fetchJobs)

module.exports = router;