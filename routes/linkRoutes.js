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
const validate = require("../middleware/validate");
const { trackingLimiter } = require("../middleware/rateLimiter");
const {
    createLinkBody,
    updateLinkBody,
    deleteLinkBody,
    likeBookmarkBody,
    trackBody,
    createAffiliateLinkBody,
    updateAffiliateLinkBody,
    fetchLinksQuery,
    linkIdParam,
} = require("../validators/linkSchemas");

const router = express.Router();

router.route("/create").post(protect, validate({ body: createLinkBody }), createLink);
router.route("/update").post(protect, validate({ body: updateLinkBody }), updateLink);
router.route("/delete").post(protect, validate({ body: deleteLinkBody }), deleteLink);
router.route("/like").post(protect, validate({ body: likeBookmarkBody }), likeDislikeLink);
router.route("/bookmark").post(protect, validate({ body: likeBookmarkBody }), bookmarkLink);
router.route("/categories").get(getCategories);

// Analytics routes
router.route("/track-view").post(trackingLimiter, validate({ body: trackBody }), trackLinkView);
router.route("/track-click").post(trackingLimiter, validate({ body: trackBody }), trackLinkClick);
router.route("/analytics").get(protect, getLinkAnalytics);

// Affiliate link routes
router.route("/affiliate/create").post(protect, validate({ body: createAffiliateLinkBody }), createAffiliateLink);
router.route("/affiliate/update").post(protect, validate({ body: updateAffiliateLinkBody }), updateAffiliateLink);
router.route("/affiliate/analytics").get(protect, getAffiliateLinkAnalytics);
router.route("/affiliate/analytics/:link_id").get(protect, getAffiliateLinkAnalytics);
router.route("/affiliate/:id").get(validate({ params: linkIdParam }), getAffiliateLinkById);
router.route("/affiliate").get(validate({ query: fetchLinksQuery }), fetchAffiliateLinks);

router.route("/").get(validate({ query: fetchLinksQuery }), fetchLinks);

module.exports = router;
