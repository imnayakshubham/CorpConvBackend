const express = require("express");

const { protect } = require("../middleware/authMiddleware");
const { postComments, postReplyComments, likeComment, deleteComment, getCommentReplies, getPostComments } = require("../controllers/commentController");
const validate = require("../middleware/validate");
const {
  postCommentBody,
  postReplyBody,
  likeCommentBody,
  deleteCommentBody,
  postIdParam,
  commentIdParam,
  paginationQuery,
} = require("../validators/commentSchemas");

const router = express.Router();

router.route("/create").post(protect, validate({ body: postCommentBody }), postComments);
router.route("/reply").post(protect, validate({ body: postReplyBody }), postReplyComments);
router.route("/delete").post(protect, validate({ body: deleteCommentBody }), deleteComment);
router.route("/like").post(protect, validate({ body: likeCommentBody }), likeComment);
router.route("/post/:post_id").get(validate({ params: postIdParam, query: paginationQuery }), getPostComments);
router.route("/replies/:comment_id").get(validate({ params: commentIdParam, query: paginationQuery }), getCommentReplies);

module.exports = router;
