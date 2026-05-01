const express = require("express");
const { Survey } = require("../models/surveyModel");
const User = require("../models/userModel");
const QuestionModel = require("../models/questionModel")
const Post = require("../models/postModel")

const router = express.Router();

const listData = async (req, res) => {
    try {
        const [surveys, users, questions, posts] = await Promise.all([
            Survey.find({ access: true, status: "published" }).select("_id createdAt"),
            User.find({ access: true }).select("_id createdAt"),
            QuestionModel.find({ access: true }).select("_id createdAt"),
            Post.find({}).select("_id createdAt"),
        ]);

        const allSurveys = surveys.map((s) => ({ path: `survey/${s._id}`, lastModified: s.createdAt }))
        const allUsers = users.map((u) => ({ path: `user/${u._id}`, lastModified: u.createdAt }))
        const allQuestions = questions.map((q) => ({ path: `qna/question/${q._id}`, lastModified: q.createdAt }))
        const allPosts = posts.map((p) => ({ path: `post/${p._id}`, lastModified: p.createdAt }))

        return res.status(200).json({
            status: 'Success',
            data: [...allSurveys, ...allUsers, ...allQuestions, ...allPosts],
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