const express = require("express");

const { protect } = require("../middleware/authMiddleware");
const { createSurvey, listSurveys, archiveSurvey, editSurvey, getSurvey, surveySubmission, getSurveySubmission } = require("../controllers/surveyController");

const router = express.Router();

// REST API endpoints (matching frontend expectations)
router.get("/", protect, listSurveys);   // GET /api/survey - List user's surveys
router.post("/", protect, createSurvey);  // POST /api/survey - Create survey
router.get("/:id", getSurvey);  // GET /api/survey/:id - Get specific survey
router.put("/:id", protect, editSurvey); // PUT /api/survey/:id - Update survey
router.delete("/:id", protect, archiveSurvey); // DELETE /api/survey/:id - Archive survey

// Additional survey-specific endpoints
router.post("/:id/submit", surveySubmission); // POST /api/survey/:id/submit - Submit survey response
router.get("/:id/submissions", protect, getSurveySubmission); // GET /api/survey/:id/submissions - Get survey submissions

// Legacy endpoints (for backwards compatibility)
router.post("/create-survey", protect, createSurvey);
router.get("/survey-list", listSurveys);
router.put("/edit/:id", protect, editSurvey);
router.post("/submission/:id", protect, surveySubmission);
router.get("/submissions/:id", protect, getSurveySubmission);

module.exports = router;