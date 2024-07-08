const express = require("express");

const { protect } = require("../middleware/authMiddleware");
const { createquestion, getquestions, deletequestion } = require("../controllers/questionControllers");

const router = express.Router();

router.route("/create").post(protect, createquestion)
router.route("/").post(getquestions)
router.route("/delete/:id").delete(protect, deletequestion)



module.exports = router;
