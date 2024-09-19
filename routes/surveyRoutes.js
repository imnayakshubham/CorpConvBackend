const express = require("express");

const { protect } = require("../middleware/authMiddleware");
const { createSurvey, listSurveys, archiveSurvey, editSurvey, getSurvey, surveySubmission } = require("../controllers/surveyController");

const router = express.Router();

router.route("/create-survey").post(protect, createSurvey);  // Create Survey
router.route("/survey-list").get(protect, listSurveys);   // List Surveys
router.route("/:id").delete(protect, archiveSurvey); // Soft Delete Survey (archive)
router.route("/edit/:id").put(protect, editSurvey); // Edit Survey
router.route("/:id").get(protect, getSurvey);
router.route("/submission/:id").post(protect, surveySubmission);

module.exports = router;