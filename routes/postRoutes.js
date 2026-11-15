const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { createPost, fetchPosts, upVotePost, updatePost, deletePost, getPost, getCategories } = require("../controllers/postController");
const validate = require("../middleware/validate");
const {
  createPostBody,
  updatePostBody,
  upVotePostBody,
  deletePostBody,
  fetchPostsQuery,
  postIdParam,
} = require("../validators/postSchemas");

const { revalidateOnSuccess } = require("../utils/frontendRevalidate");

const router = express.Router();

const revalidatePosts = revalidateOnSuccess((req) => ["posts", "sitemap", `post:${req.body?._id}`]);

router.route("/create").post(protect, validate({ body: createPostBody }), revalidatePosts, createPost);
router.route("/all-posts").get(validate({ query: fetchPostsQuery }), fetchPosts);
router.route("/upvote").post(protect, validate({ body: upVotePostBody }), upVotePost);
router.route("/update").post(protect, validate({ body: updatePostBody }), revalidatePosts, updatePost);
router.route("/delete").post(protect, validate({ body: deletePostBody }), revalidatePosts, deletePost);
router.route("/categories").get(getCategories);
router.route("/:id").get(validate({ params: postIdParam }), getPost);

module.exports = router;
