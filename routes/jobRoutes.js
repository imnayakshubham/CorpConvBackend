const express = require("express");

const { protect } = require("../middleware/authMiddleware");
const { createJob, fetchJobs, updateJob, deleteJob, likeDislikeJob, bookMarkJob } = require("../controllers/jobsControllers");

const router = express.Router();

router.route("/create").post(protect, createJob)
router.route("/update").post(protect, updateJob)
router.route("/delete").post(protect, deleteJob)
router.route("/delete").post(protect, deleteJob)
router.route("/like").post(protect, likeDislikeJob)
router.route("/bookmark").post(protect, bookMarkJob)
router.route("/").get(fetchJobs)

module.exports = router;

