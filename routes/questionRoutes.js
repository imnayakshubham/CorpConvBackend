const express = require("express");

const { protect, optionalAuth } = require("../middleware/authMiddleware");
const { createquestion, getquestions, deletequestion, getquestionbyid, updatequestion } = require("../controllers/questionControllers");
const validate = require("../middleware/validate");
const { getQuestionsQuery, questionIdParam, createQuestionBody, updateQuestionBody } = require("../validators/questionSchemas");

const router = express.Router();

router.route("/create").post(protect, validate({ body: createQuestionBody }), createquestion);
router.route("/").get(optionalAuth, validate({ query: getQuestionsQuery }), getquestions);
router.route("/delete/:id").delete(protect, validate({ params: questionIdParam }), deletequestion);
router.route("/update/:id").patch(protect, validate({ params: questionIdParam, body: updateQuestionBody }), updatequestion);
router.route("/:id").get(optionalAuth, validate({ params: questionIdParam }), getquestionbyid);

module.exports = router;
