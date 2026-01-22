const QuestionModel = require("../models/questionModel")
const { getIo } = require("../utils/socketManger")



const createquestion = async (req, res) => {
    try {
        const question_posted_by = req.user._id
        const newQuestion = await QuestionModel.create({ question_posted_by })
        if (newQuestion) {
            // Populate and broadcast to questions_list room
            const populatedQuestion = await newQuestion.populate(
                'question_posted_by',
                'public_user_name user_public_profile_pic'
            );
            const io = getIo();
            io.to("questions_list").emit("new_question_created", populatedQuestion);

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
        const limit = parseInt(req.query.limit) || 10;
        const cursor = req.query.cursor || null;
        const search = req.query.search || '';
        const sortBy = req.query.sortBy || 'newest';
        const filter = req.query.filter || 'all';
        const userId = req.query.userId || null;

        // Build query
        let query = { access: true };

        // Filter: my questions
        if (filter === 'my-questions' && userId) {
            query.question_posted_by = userId;
        }

        // Search: case-insensitive regex
        if (search.trim()) {
            query.question = { $regex: search.trim(), $options: 'i' };
        }

        // Cursor pagination (for newest/oldest)
        if (cursor) {
            if (sortBy === 'oldest') {
                query.createdAt = { $gt: new Date(cursor) };
            } else {
                query.createdAt = { $lt: new Date(cursor) };
            }
        }

        let questions;

        if (sortBy === 'most-answers' || sortBy === 'most-liked') {
            // Aggregation for computed sorts
            const sortField = sortBy === 'most-answers' ? 'answersCount' : 'likedCount';
            const pipeline = [
                { $match: query },
                {
                    $addFields: {
                        answersCount: { $size: { $ifNull: ['$answers', []] } },
                        likedCount: { $size: { $ifNull: ['$liked_by', []] } }
                    }
                },
                { $sort: { [sortField]: -1, createdAt: -1 } },
                { $limit: limit + 1 },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'question_posted_by',
                        foreignField: '_id',
                        as: 'question_posted_by',
                        pipeline: [{ $project: { public_user_name: 1, user_public_profile_pic: 1 } }]
                    }
                },
                { $unwind: { path: '$question_posted_by', preserveNullAndEmptyArrays: true } }
            ];
            questions = await QuestionModel.aggregate(pipeline);
        } else {
            // Simple find for date sorts
            const sortOptions = sortBy === 'oldest' ? { createdAt: 1 } : { createdAt: -1 };
            questions = await QuestionModel.find(query)
                .sort(sortOptions)
                .limit(limit + 1)
                .populate('question_posted_by', 'public_user_name user_public_profile_pic')
                .lean();
        }

        const hasMore = questions.length > limit;
        const resultQuestions = hasMore ? questions.slice(0, limit) : questions;
        const nextCursor = hasMore && resultQuestions.length > 0
            ? resultQuestions[resultQuestions.length - 1].createdAt
            : null;

        return res.status(200).json({
            status: 'Success',
            data: { questions: resultQuestions, nextCursor, hasMore },
            message: 'Questions fetched successfully'
        });
    } catch (error) {
        console.error('Error fetching questions:', error);
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: 'Something went wrong'
        });
    }
}

const deletequestion = async (req, res) => {
    try {
        const _id = req.params.id
        const updatedQuestion = await QuestionModel.findByIdAndUpdate(_id, { access: false }, { new: true })
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

        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Something went Wrong"
        })
    }
}

const getquestionbyid = async (req, res) => {
    try {
        const _id = req.params.id
        const question = await QuestionModel.findById(_id)
            .populate("question_posted_by", "public_user_name user_public_profile_pic")
            .populate({
                path: "answers",
                populate: {
                    path: "answered_by",
                    select: "public_user_name user_public_profile_pic"
                }
            })

        if (question) {
            return res.status(200).json({
                status: 'Success',
                data: question,
                message: "Question Fetched successfully"
            })
        } else {
            return res.status(404).json({
                status: 'Failed',
                message: "Question not found",
                data: null
            })
        }
    } catch (error) {
        console.log(error)
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
    deletequestion,
    getquestionbyid
}