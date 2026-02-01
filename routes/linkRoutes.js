const express = require("express");

const { protect } = require("../middleware/authMiddleware");
const {
    createLink,
    fetchLinks,
    updateLink,
    deleteLink,
    likeDislikeLink,
    bookmarkLink,
    getCategories,
    trackLinkView,
    trackLinkClick,
    getLinkAnalytics,
    createAffiliateLink,
    fetchAffiliateLinks,
    updateAffiliateLink,
    getAffiliateLinkById,
    getAffiliateLinkAnalytics,
} = require("../controllers/linksController");

const router = express.Router();

router.route("/create").post(protect, createLink);
router.route("/update").post(protect, updateLink);
router.route("/delete").post(protect, deleteLink);
router.route("/like").post(protect, likeDislikeLink);
router.route("/bookmark").post(protect, bookmarkLink);
router.route("/categories").get(getCategories);

// Analytics routes
router.route("/track-view").post(trackLinkView);
router.route("/track-click").post(trackLinkClick);
router.route("/analytics").get(protect, getLinkAnalytics);

// Affiliate link routes
router.route("/affiliate/create").post(protect, createAffiliateLink);
router.route("/affiliate/update").post(protect, updateAffiliateLink);
router.route("/affiliate/analytics").get(protect, getAffiliateLinkAnalytics);
router.route("/affiliate/analytics/:link_id").get(protect, getAffiliateLinkAnalytics);
router.route("/affiliate/:id").get(getAffiliateLinkById);
router.route("/affiliate").get(fetchAffiliateLinks);

router.route("/").get(fetchLinks);

module.exports = router;
