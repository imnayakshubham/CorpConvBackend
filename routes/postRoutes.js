

const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { createPost, fetchPosts, upVotePost, updatePost, deletePost } = require("../controllers/postController");

const router = express.Router();

router.route("/create").post(protect, createPost);
router.route("/all-posts").get(fetchPosts);
router.route("/upvote").post(protect, upVotePost);
router.route("/update").post(protect, updatePost);
router.route("/delete").post(protect, deletePost);

module.exports = router;
