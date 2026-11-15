const express = require("express");

const { protect, optionalAuth } = require("../middleware/authMiddleware");
const { createSurvey, listSurveys, archiveSurvey, unpublishSurvey, editSurvey, getSurvey, surveySubmission, getSurveySubmission, getAvailableTags, trackSurveyView, getSurveyAnalytics, verifySurveyPin } = require("../controllers/surveyController");
const validate = require("../middleware/validate");
const { trackingLimiter, submissionLimiter } = require("../middleware/rateLimiter");
const {
  createSurveyBody,
  editSurveyBody,
  surveySubmissionBody,
  listSurveysQuery,
  surveyIdParam,
  verifyPinBody,
  tagsQuery,
} = require("../validators/surveySchemas");

const { revalidateOnSuccess } = require("../utils/frontendRevalidate");

const router = express.Router();

const revalidateSurveys = revalidateOnSuccess((req) => ["surveys", "sitemap", `survey:${req.params?.id}`]);

router.route("/create-survey").post(protect, validate({ body: createSurveyBody }), revalidateSurveys, createSurvey);
router.route("/survey-list").get(optionalAuth, validate({ query: listSurveysQuery }), listSurveys);
router.route("/tags").get(optionalAuth, validate({ query: tagsQuery }), getAvailableTags);
router.route("/:id").delete(protect, validate({ params: surveyIdParam }), revalidateSurveys, archiveSurvey);
router.route("/unpublish/:id").put(protect, validate({ params: surveyIdParam }), revalidateSurveys, unpublishSurvey);
router.route("/edit/:id").put(protect, validate({ params: surveyIdParam, body: editSurveyBody }), revalidateSurveys, editSurvey);

// Analytics routes
router.route("/track-view/:id").post(trackingLimiter, validate({ params: surveyIdParam }), trackSurveyView);
router.route("/analytics/:id").get(protect, validate({ params: surveyIdParam }), getSurveyAnalytics);

router.route("/:id").get(optionalAuth, validate({ params: surveyIdParam }), getSurvey);
router.route("/verify-pin/:id").post(submissionLimiter, validate({ params: surveyIdParam, body: verifyPinBody }), verifySurveyPin);
router.route("/submission/:id").post(protect, submissionLimiter, validate({ params: surveyIdParam, body: surveySubmissionBody }), surveySubmission);
router.route("/submissions/:id").get(protect, validate({ params: surveyIdParam }), getSurveySubmission);

module.exports = router;
