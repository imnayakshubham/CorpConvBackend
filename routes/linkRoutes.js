const express = require("express");

const { protect } = require("../middleware/authMiddleware");
const {
    createLink,
    fetchLinks,
    updateLink,
    deleteLink,
    likeDislikeLink,
    bookmarkLink,
    getCategories
} = require("../controllers/linksController");

const router = express.Router();

router.route("/create").post(protect, createLink);
router.route("/update").post(protect, updateLink);
router.route("/delete").post(protect, deleteLink);
router.route("/like").post(protect, likeDislikeLink);
router.route("/bookmark").post(protect, bookmarkLink);
router.route("/categories").get(getCategories);
router.route("/").get(fetchLinks);

module.exports = router;
