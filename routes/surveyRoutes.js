const express = require("express");

const { protect } = require("../middleware/authMiddleware");
const { createSurvey, listSurveys, archiveSurvey, unpublishSurvey, editSurvey, getSurvey, surveySubmission, getSurveySubmission } = require("../controllers/surveyController");

const router = express.Router();

router.route("/create-survey").post(protect, createSurvey);  // Create Survey
router.route("/survey-list").get(protect, listSurveys);   // List Surveys
router.route("/:id").delete(protect, archiveSurvey); // Soft Delete Survey (archive)
router.route("/unpublish/:id").put(protect, unpublishSurvey); // Unpublish Survey (revert to draft)
router.route("/edit/:id").put(protect, editSurvey); // Edit Survey
router.route("/:id").get(getSurvey);
router.route("/submission/:id").post(protect, surveySubmission);
router.route("/submissions/:id").get(protect, getSurveySubmission);

module.exports = router;