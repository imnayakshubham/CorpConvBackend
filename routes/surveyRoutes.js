const express = require("express");

const { protect, optionalAuth } = require("../middleware/authMiddleware");
const { createSurvey, listSurveys, archiveSurvey, unpublishSurvey, editSurvey, getSurvey, surveySubmission, getSurveySubmission, getAvailableTags } = require("../controllers/surveyController");

const router = express.Router();

router.route("/create-survey").post(protect, createSurvey);  // Create Survey
router.route("/survey-list").get(optionalAuth, listSurveys);   // List Surveys (optional auth)
router.route("/tags").get(getAvailableTags);   // Get available tags for filtering
router.route("/:id").delete(protect, archiveSurvey); // Soft Delete Survey (archive)
router.route("/unpublish/:id").put(protect, unpublishSurvey); // Unpublish Survey (revert to draft)
router.route("/edit/:id").put(protect, editSurvey); // Edit Survey
router.route("/:id").get(getSurvey);
router.route("/submission/:id").post(protect, surveySubmission);
router.route("/submissions/:id").get(protect, getSurveySubmission);

module.exports = router;