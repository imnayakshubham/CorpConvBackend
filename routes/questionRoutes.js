const express = require("express");

const { protect } = require("../middleware/authMiddleware");
const { createquestion, getquestions, deletequestion, getquestionbyid } = require("../controllers/questionControllers");
const validate = require("../middleware/validate");
const { getQuestionsQuery, questionIdParam, createQuestionBody } = require("../validators/questionSchemas");

const router = express.Router();

router.route("/create").post(protect, validate({ body: createQuestionBody }), createquestion);
router.route("/").get(validate({ query: getQuestionsQuery }), getquestions);
router.route("/delete/:id").delete(protect, validate({ params: questionIdParam }), deletequestion);
router.route("/:id").get(validate({ params: questionIdParam }), getquestionbyid);

module.exports = router;
