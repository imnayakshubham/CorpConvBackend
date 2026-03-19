const express = require("express");

const { protect, optionalAuth } = require("../middleware/authMiddleware");
const { createSurvey, listSurveys, archiveSurvey, unpublishSurvey, editSurvey, getSurvey, surveySubmission, getSurveySubmission, getAvailableTags, trackSurveyView, getSurveyAnalytics } = require("../controllers/surveyController");
const validate = require("../middleware/validate");
const { trackingLimiter, submissionLimiter } = require("../middleware/rateLimiter");
const {
  createSurveyBody,
  editSurveyBody,
  surveySubmissionBody,
  listSurveysQuery,
  surveyIdParam,
  tagsQuery,
} = require("../validators/surveySchemas");

const router = express.Router();

router.route("/create-survey").post(protect, validate({ body: createSurveyBody }), createSurvey);
router.route("/survey-list").get(optionalAuth, validate({ query: listSurveysQuery }), listSurveys);
router.route("/tags").get(validate({ query: tagsQuery }), getAvailableTags);
router.route("/:id").delete(protect, validate({ params: surveyIdParam }), archiveSurvey);
router.route("/unpublish/:id").put(protect, validate({ params: surveyIdParam }), unpublishSurvey);
router.route("/edit/:id").put(protect, validate({ params: surveyIdParam, body: editSurveyBody }), editSurvey);

// Analytics routes
router.route("/track-view/:id").post(trackingLimiter, validate({ params: surveyIdParam }), trackSurveyView);
router.route("/analytics/:id").get(protect, validate({ params: surveyIdParam }), getSurveyAnalytics);

router.route("/:id").get(validate({ params: surveyIdParam }), getSurvey);
router.route("/submission/:id").post(protect, submissionLimiter, validate({ params: surveyIdParam, body: surveySubmissionBody }), surveySubmission);
router.route("/submissions/:id").get(protect, validate({ params: surveyIdParam }), getSurveySubmission);

module.exports = router;
