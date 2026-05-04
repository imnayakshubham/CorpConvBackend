const mongoose = require("mongoose");
const QuestionModel = require("../models/questionModel")
const ActivityEvent = require("../models/activityEventModel")
const { getIo } = require("../utils/socketManger")
const cache = require("../redisClient/cacheHelper")
const TTL = require("../redisClient/cacheTTL")
const escapeRegex = require("../utils/escapeRegex")



const createquestion = async (req, res) => {
    try {
        const question_posted_by = req.user._id
        const { question, status: rawStatus, visibility = 'public', openAt, closeAt } = req.body || {};

        // Derive status from dates if not explicitly set
        let status = rawStatus || 'open';
        if (!rawStatus) {
            if (openAt && new Date(openAt) > new Date()) {
                status = 'draft';
            } else if (closeAt && new Date(closeAt) < new Date()) {
                status = 'closed';
            }
        }

        // Only attach workspace_id for workspace-scoped questions
        const workspace_id = visibility === 'workspace' ? (req.activeOrganizationId || null) : null;

        const newQuestion = await QuestionModel.create({
            question_posted_by,
            ...(question && { question }),
            status,
            visibility,
            workspace_id,
            openAt: openAt ? new Date(openAt) : null,
            closeAt: closeAt ? new Date(closeAt) : null,
        })
        if (newQuestion) {
            await cache.delByPattern(`${process.env.APP_ENV || 'DEV'}:questions:list:*`)

            const populatedQuestion = await newQuestion.populate(
                'question_posted_by',
                'public_user_name user_public_profile_pic'
            );
            const io = getIo();
            io.to("questions_list").emit("new_question_created", populatedQuestion);
            ActivityEvent.create({ userId: req.user._id, eventType: 'question_asked' }).catch(() => {});

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
        const activeOrganizationId = req.activeOrganizationId || null;

        const shouldCache = !cursor && !search.trim() && filter === 'all';
        const cacheKey = shouldCache ? cache.generateKey('questions', 'list', sortBy, filter) : null;

        if (shouldCache) {
            const cached = await cache.get(cacheKey);
            if (cached) {
                return res.status(200).json({
                    status: 'Success',
                    data: cached,
                    message: 'Questions fetched successfully (Cached)'
                });
            }
        }

        // Build base match query
        let matchQuery = { access: true };

        // Workspace visibility: only include workspace questions if user is in that workspace
        if (activeOrganizationId) {
            matchQuery.$or = [
                { visibility: 'public' },
                { visibility: 'workspace', workspace_id: new mongoose.Types.ObjectId(activeOrganizationId) }
            ];
        } else {
            matchQuery.visibility = 'public';
        }

        if (filter === 'my-questions' && userId) {
            matchQuery.question_posted_by = new mongoose.Types.ObjectId(userId);
        }

        if (search.trim()) {
            matchQuery.question = { $regex: escapeRegex(search.trim()), $options: 'i' };
        }

        // Cursor pagination
        if (cursor) {
            if (sortBy === 'oldest') {
                matchQuery.createdAt = { $gt: new Date(cursor) };
            } else if (sortBy === 'newest') {
                matchQuery.createdAt = { $lt: new Date(cursor) };
            }
        }

        const sortStage = sortBy === 'oldest'
            ? { createdAt: 1 }
            : sortBy === 'most-answers'
                ? { answersCount: -1, createdAt: -1 }
                : sortBy === 'most-liked'
                    ? { likedCount: -1, createdAt: -1 }
                    : { createdAt: -1 };

        // Single unified aggregation pipeline for all sort types.
        // Uses $lookup to count only access:true answers (fixes stale-count bug).
        const pipeline = [
            { $match: matchQuery },
            {
                $lookup: {
                    from: 'answertoquestions',
                    let: { answerIds: { $ifNull: ['$answers', []] } },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $in: ['$_id', '$$answerIds'] },
                                        { $eq: ['$access', true] }
                                    ]
                                }
                            }
                        },
                        { $count: 'n' }
                    ],
                    as: '_activeAnswerCount'
                }
            },
            {
                $addFields: {
                    answersCount: { $ifNull: [{ $arrayElemAt: ['$_activeAnswerCount.n', 0] }, 0] },
                    likedCount: { $size: { $ifNull: ['$liked_by', []] } },
                }
            },
            { $project: { _activeAnswerCount: 0, answers: 0 } },
            { $sort: sortStage },
            { $limit: limit + 1 },
            {
                $lookup: {
                    from: 'users',
                    localField: 'question_posted_by',
                    foreignField: '_id',
                    as: 'question_posted_by',
                    pipeline: [{ $project: { public_user_name: 1, user_public_profile_pic: 1, avatar_config: 1 } }]
                }
            },
            { $unwind: { path: '$question_posted_by', preserveNullAndEmptyArrays: true } }
        ];

        const questions = await QuestionModel.aggregate(pipeline);

        const hasMore = questions.length > limit;
        const resultQuestions = hasMore ? questions.slice(0, limit) : questions;
        const nextCursor = hasMore && resultQuestions.length > 0
            ? resultQuestions[resultQuestions.length - 1].createdAt
            : null;

        const responseData = { questions: resultQuestions, nextCursor, hasMore };

        if (shouldCache) {
            await cache.set(cacheKey, responseData, TTL.QUESTIONS_LIST);
        }

        return res.status(200).json({
            status: 'Success',
            data: responseData,
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
            const questionKey = cache.generateKey('question', _id);
            await cache.del(questionKey);
            await cache.delByPattern(`${process.env.APP_ENV || 'DEV'}:questions:list:*`);

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
        const activeOrganizationId = req.activeOrganizationId || null;

        const cacheKey = cache.generateKey('question', _id);
        const cached = await cache.get(cacheKey);
        if (cached) {
            // Workspace enforcement on cached result
            if (cached.visibility === 'workspace') {
                if (!activeOrganizationId || activeOrganizationId !== cached.workspace_id?.toString()) {
                    return res.status(403).json({ status: 'Failed', message: 'Access restricted to workspace members', data: null });
                }
            }
            return res.status(200).json({
                status: 'Success',
                data: cached,
                message: "Question Fetched successfully (Cached)"
            });
        }

        let question = await QuestionModel.findById(_id)
            .populate("question_posted_by", "public_user_name user_public_profile_pic avatar_config")
            .populate({
                path: "answers",
                match: { access: true },
                populate: {
                    path: "answered_by",
                    select: "public_user_name user_public_profile_pic avatar_config"
                }
            })

        if (!question) {
            return res.status(404).json({ status: 'Failed', message: "Question not found", data: null })
        }

        // Workspace enforcement
        if (question.visibility === 'workspace') {
            if (!activeOrganizationId || activeOrganizationId !== question.workspace_id?.toString()) {
                return res.status(403).json({ status: 'Failed', message: 'Access restricted to workspace members', data: null });
            }
        }

        // Auto-transition status if closeAt has passed
        if (question.closeAt && question.closeAt < new Date() && question.status === 'open') {
            question = await QuestionModel.findByIdAndUpdate(_id, { status: 'closed' }, { new: true })
                .populate("question_posted_by", "public_user_name user_public_profile_pic avatar_config")
                .populate({
                    path: "answers",
                    match: { access: true },
                    populate: {
                        path: "answered_by",
                        select: "public_user_name user_public_profile_pic avatar_config"
                    }
                });
        }

        await cache.set(cacheKey, question.toObject(), TTL.QUESTION_DETAIL);

        return res.status(200).json({
            status: 'Success',
            data: question,
            message: "Question Fetched successfully"
        })
    } catch (error) {
        console.log(error)
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Something went Wrong"
        })
    }
}

const updatequestion = async (req, res) => {
    try {
        const _id = req.params.id;
        const question = await QuestionModel.findById(_id);
        if (!question) {
            return res.status(404).json({ status: 'Failed', message: 'Question not found', data: null });
        }
        if (question.question_posted_by?.toString() !== req.user._id.toString()) {
            return res.status(403).json({ status: 'Failed', message: 'Not authorised', data: null });
        }
        const { status, visibility, openAt, closeAt } = req.body;
        const updates = {};
        if (status !== undefined) updates.status = status;
        if (visibility !== undefined) {
            updates.visibility = visibility;
            updates.workspace_id = visibility === 'workspace' ? (req.activeOrganizationId || null) : null;
        }
        if (openAt !== undefined) updates.openAt = openAt ? new Date(openAt) : null;
        if (closeAt !== undefined) updates.closeAt = closeAt ? new Date(closeAt) : null;

        const updated = await QuestionModel.findByIdAndUpdate(_id, updates, { new: true })
            .populate('question_posted_by', 'public_user_name user_public_profile_pic avatar_config');

        const cacheKey = cache.generateKey('question', _id);
        await cache.del(cacheKey);
        await cache.delByPattern(`${process.env.APP_ENV || 'DEV'}:questions:list:*`);

        return res.status(200).json({ status: 'Success', data: updated, message: 'Question updated' });
    } catch (error) {
        return res.status(500).json({ data: null, status: 'Failed', message: 'Something went Wrong' });
    }
};

module.exports = {
    createquestion,
    getquestions,
    deletequestion,
    getquestionbyid,
    updatequestion,
}
