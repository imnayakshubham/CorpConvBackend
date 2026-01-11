const express = require("express");

const { protect } = require("../middleware/authMiddleware");
const { createquestion, getquestions, deletequestion, getquestionbyid } = require("../controllers/questionControllers");

const router = express.Router();

router.route("/create").post(protect, createquestion)
router.route("/").post(getquestions)
router.route("/delete/:id").delete(protect, deletequestion)
router.route("/:id").get(getquestionbyid)



module.exports = router;
