

const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { createPost, fetchPosts, upVotePost, downVotePost, awardPost, sharePost, updatePost, deletePost, getPost, reportPost, getCategories } = require("../controllers/postController");

const router = express.Router();

router.route("/create").post(protect, createPost);
router.route("/").get(fetchPosts);
router.route("/upvote").post(protect, upVotePost);
router.route("/downvote").post(protect, downVotePost);
router.route("/award").post(protect, awardPost);
router.route("/share").post(protect, sharePost);
router.route("/update").post(protect, updatePost);
router.route("/delete").post(protect, deletePost);
router.route("/:id").get(getPost);
router.route("/report").post(protect, reportPost);
router.route("/categories").get(getCategories);

module.exports = router;