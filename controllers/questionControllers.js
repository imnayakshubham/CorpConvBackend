const QuestionModel = require("../models/questionModel")



const createquestion = async (req, res) => {
    try {
        const question_posted_by = req.user._id
        const newQuestion = await QuestionModel.create({ question_posted_by })
        if (newQuestion) {
            return res.status(201).json({
                status: 'Success',
                data: newQuestion,
                message: "Question created successfully"
            })
        } else {
            return res.status(400).json({
                status: 'Failed',
                message: "Failed to create a Question",
                data: null
            })
        }
    } catch (error) {

        console.log({ error })
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Job not created"
        })
    }
}

const getquestions = async (req, res) => {
    try {
        const payload = req.body
        console.log({ payload })
        const updatedPayload = payload.type === "your-questions" ? {
            question_posted_by: payload.user_id
        } : {}
        const allQuestions = await QuestionModel.find({ ...updatedPayload, access: true }).populate("question_posted_by", "public_user_name user_public_profile_pic")
        console.log(allQuestions)
        if (!!allQuestions.length) {
            return res.status(201).json({
                status: 'Success',
                data: { [payload.type]: allQuestions },
                message: "Questions Fetched successfully"
            })
        } else {
            return res.status(400).json({
                status: 'Failed',
                message: "Failed to Fetch a Questions",
                data: { [payload.type]: allQuestions }
            })
        }
    } catch (error) {

        console.log({ error })
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Something went Wrong"
        })
    }
}

const deletequestion = async (req, res) => {
    try {
        const _id = req.params.id
        console.log({ _id })
        const updatedQuestion = await QuestionModel.findByIdAndUpdate(_id, { access: false }, { new: true })
        console.log(updatedQuestion)
        if (updatedQuestion) {
            return res.status(201).json({
                status: 'Success',
                data: null,
                message: "Question Deleted successfully"
            })
        } else {
            return res.status(400).json({
                status: 'Failed',
                message: "Failed to Delete a Question",
                data: null
            })
        }
    } catch (error) {

        console.log({ error })
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Something went Wrong"
        })
    }
}

module.exports = {
    createquestion,
    getquestions,
    deletequestion
}