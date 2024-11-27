const express = require("express");
const { Survey } = require("../models/surveyModel");
const User = require("../models/userModel");
const QuestionModel = require("../models/questionModel")

const router = express.Router();

const listData = async (req, res) => {
    try {
        const surveys = await Survey.find({ access: true, status: "published" }).select("_id")
        const users = await User.find({ access: true }).select("_id")
        const questions = await QuestionModel.find({ access: true }).select("_id")

        const allSurveys = surveys.map((survey) => `surveys/${survey._id}`)
        const allUsers = users.map((user) => `user/${user._id}`)
        const allQuestions = questions.map((question) => `answerlink/question/${question._id}`)

        return res.status(200).json({
            status: 'Success',
            data: [...(allSurveys ?? []), ...(allUsers ?? []), ...(allQuestions ?? [])],
            message: 'retrieved successfully'
        });
    } catch (error) {
        return res.status(500).json({
            status: 'Failed',
            message: 'Server Error: Unable to fetch',
            data: null
        });
    }
}

router.route("/data").get(listData);

module.exports = router;