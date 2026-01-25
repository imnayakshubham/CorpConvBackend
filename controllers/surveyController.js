const { Survey, Submission } = require("../models/surveyModel");
const cache = require("../redisClient/cacheHelper");
const TTL = require("../redisClient/cacheTTL");

// CREATE Survey API
const createSurvey = async (req, res) => {
    try {
        const payload = req.body;
        const updatedPayload = {
            survey_title: payload.survey_title.trim(),
            survey_description: payload.survey_description.trim(),
            created_by: req.user._id
        }

        // Validation
        if (updatedPayload.survey_title.length < 3) {
            return res.status(400).json({
                status: 'Failed',
                message: 'Survey title must be at least 3 characters long',
                data: null
            });
        }

        const newSurvey = new Survey({
            ...updatedPayload,
        });


        const savedSurvey = await newSurvey.save();

        // Invalidate surveys list cache (all patterns)
        await cache.delByPattern(`${process.env.APP_ENV || 'DEV'}:surveys:list:*`);
        await cache.del(cache.generateKey('surveys', 'tags'));

        return res.status(201).json({
            status: 'Success',
            data: savedSurvey,
            message: 'Survey created successfully'
        });
    } catch (error) {
        console.log({ error })
        return res.status(500).json({
            status: 'Failed',
            message: 'Server Error: Survey not created',
            data: null
        });
    }
}

// LIST Surveys API with search, filtering, and pagination
const listSurveys = async (req, res) => {
    try {
        const {
            view = 'all',      // 'my' or 'all'
            search,
            status,            // comma-separated: 'draft,published'
            tags,              // comma-separated: 'tag1,tag2'
            dateFrom,
            dateTo,
            createdBy,
            sortBy = 'newest', // 'newest', 'oldest', 'mostResponses', 'alphabetical'
            limit = 12,
            cursor             // ISO date string for cursor-based pagination
        } = req.query;

        // Build query
        const query = { access: true };

        // View logic
        if (view === 'my') {
            // Requires auth
            if (!req.user) {
                return res.status(401).json({
                    status: 'Failed',
                    message: 'Authentication required for "My Surveys" view',
                    data: null
                });
            }
            query.created_by = req.user._id;
        } else {
            // 'all' view - only published surveys
            query.status = 'published';
        }

        // Search filter (regex-based for partial matching)
        if (search && search.trim()) {
            const searchRegex = new RegExp(search.trim(), 'i');
            query.$or = [
                { survey_title: searchRegex },
                { survey_description: searchRegex },
                { tags: searchRegex }
            ];
        }

        // Status filter (for 'my' view)
        if (status && view === 'my') {
            const statusList = status.split(',').filter(s => ['draft', 'published', 'archived'].includes(s));
            if (statusList.length > 0) {
                query.status = { $in: statusList };
            }
        }

        // Tags filter
        if (tags) {
            const tagList = tags.split(',').filter(Boolean);
            if (tagList.length > 0) {
                query.tags = { $in: tagList };
            }
        }

        // Date range filter
        if (dateFrom || dateTo) {
            query.createdAt = {};
            if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
            if (dateTo) query.createdAt.$lte = new Date(dateTo);
        }

        // Created by filter (for 'all' view)
        if (createdBy && view === 'all') {
            query.created_by = createdBy;
        }

        // Cursor-based pagination
        if (cursor) {
            const cursorDate = new Date(cursor);
            if (sortBy === 'oldest') {
                query.createdAt = { ...query.createdAt, $gt: cursorDate };
            } else {
                query.createdAt = { ...query.createdAt, $lt: cursorDate };
            }
        }

        // Sort options
        let sortOptions = {};
        switch (sortBy) {
            case 'oldest':
                sortOptions = { createdAt: 1 };
                break;
            case 'mostResponses':
                sortOptions = { 'submissions': -1, createdAt: -1 };
                break;
            case 'alphabetical':
                sortOptions = { survey_title: 1 };
                break;
            case 'newest':
            default:
                sortOptions = { createdAt: -1 };
                break;
        }

        // Check cache for first page only (no cursor, no search, no complex filters)
        const isFirstPage = !cursor && !search && !tags && !dateFrom && !dateTo && !createdBy;
        const cacheKey = view === 'my'
            ? cache.generateKey('surveys', 'list', 'my', req.user?._id, status || 'all', sortBy)
            : cache.generateKey('surveys', 'list', 'all', sortBy);

        if (isFirstPage) {
            const cached = await cache.get(cacheKey);
            if (cached) {
                return res.status(200).json({
                    status: 'Success',
                    data: cached,
                    message: 'Surveys retrieved successfully (Cached)'
                });
            }
        }

        // Fetch surveys
        const parsedLimit = Math.min(parseInt(limit) || 12, 50);
        const surveys = await Survey.find(query)
            .sort(sortOptions)
            .limit(parsedLimit + 1) // Fetch one extra to determine hasMore
            .select('survey_title survey_description status submissions tags view_count createdAt created_by')
            .populate('created_by', 'name avatarUrl');

        // Determine pagination
        const hasMore = surveys.length > parsedLimit;
        const resultSurveys = hasMore ? surveys.slice(0, parsedLimit) : surveys;
        const nextCursor = hasMore && resultSurveys.length > 0
            ? resultSurveys[resultSurveys.length - 1].createdAt.toISOString()
            : null;

        const responseData = {
            surveys: resultSurveys,
            nextCursor,
            hasMore
        };

        // Cache first page results
        if (isFirstPage) {
            await cache.set(cacheKey, responseData, TTL.SURVEYS_LIST);
        }

        return res.status(200).json({
            status: 'Success',
            data: responseData,
            message: 'Surveys retrieved successfully'
        });
    } catch (error) {
        console.error('List surveys error:', error);
        return res.status(500).json({
            status: 'Failed',
            message: 'Server Error: Unable to fetch surveys',
            data: null
        });
    }
}

// SOFT DELETE Survey (change status)
const archiveSurvey = async (req, res) => {
    try {
        const surveyId = req.params.id;
        const survey = await Survey.findById(surveyId);

        if (!survey) {
            return res.status(404).json({
                status: 'Failed',
                message: 'Survey not found',
                data: null
            });
        }

        // Soft delete by setting status to 'archived'
        survey.access = false;

        await survey.save();

        // Invalidate caches
        await cache.delByPattern(`${process.env.APP_ENV || 'DEV'}:surveys:list:*`);
        await cache.del(cache.generateKey('surveys', 'tags'));
        await cache.del(cache.generateKey('survey', surveyId));

        return res.status(200).json({
            status: 'Success',
            data: null,
            message: 'Survey Deleted successfully'
        });
    } catch (error) {
        return res.status(500).json({
            status: 'Failed',
            message: 'Server Error: Unable to archive survey',
            data: null
        });
    }
}

// EDIT Survey API
const editSurvey = async (req, res) => {
    try {
        const surveyId = req.params.id;

        const survey = await Survey.findById(surveyId);

        if (!survey) {
            return res.status(404).json({
                status: 'Failed',
                message: 'Survey not found',
                data: null
            });
        }
        let updatedPayload = req.body;
        const payloadKeys = Object.keys(updatedPayload)
        if (payloadKeys.includes("survey_title") && payloadKeys.includes("survey_description")) {
            updatedPayload = {
                survey_title: updatedPayload.survey_title.trim(),
                survey_description: updatedPayload.survey_description.trim(),
                ...updatedPayload
            }
            if (updatedPayload.survey_title.length < 3) {
                return res.status(400).json({
                    status: 'Failed',
                    message: 'Survey title must be at least 3 characters long',
                    data: null
                });
            }
        }



        const updatedSurvey = await Survey.findByIdAndUpdate(surveyId, { ...updatedPayload }, { new: true })

        // Invalidate caches
        await cache.delByPattern(`${process.env.APP_ENV || 'DEV'}:surveys:list:*`);
        await cache.del(cache.generateKey('surveys', 'tags'));
        await cache.del(cache.generateKey('survey', surveyId));

        return res.status(200).json({
            status: 'Success',
            data: updatedSurvey,
            message: 'Survey updated successfully'
        });
    } catch (error) {
        console.log({ error })
        return res.status(500).json({
            status: 'Failed',
            message: 'Server Error: Unable to update survey',
            data: null
        });
    }
};

// UNPUBLISH Survey (change status from published to draft)
const unpublishSurvey = async (req, res) => {
    try {
        const surveyId = req.params.id;
        const survey = await Survey.findById(surveyId);

        if (!survey) {
            return res.status(404).json({
                status: 'Failed',
                message: 'Survey not found',
                data: null
            });
        }

        if (survey.status !== 'published') {
            return res.status(400).json({
                status: 'Failed',
                message: 'Survey is not published',
                data: null
            });
        }

        survey.status = 'draft';
        await survey.save();

        // Invalidate caches
        await cache.delByPattern(`${process.env.APP_ENV || 'DEV'}:surveys:list:*`);
        await cache.del(cache.generateKey('surveys', 'tags'));
        await cache.del(cache.generateKey('survey', surveyId));

        return res.status(200).json({
            status: 'Success',
            data: survey,
            message: 'Survey unpublished successfully'
        });
    } catch (error) {
        console.log({ error });
        return res.status(500).json({
            status: 'Failed',
            message: 'Server Error: Unable to unpublish survey',
            data: null
        });
    }
};

const getSurvey = async (req, res) => {
    try {
        const surveyId = req.params.id;

        // Try to get from cache
        const cacheKey = cache.generateKey('survey', surveyId);
        const cached = await cache.get(cacheKey);
        if (cached) {
            return res.status(200).json({
                status: 'Success',
                data: cached,
                message: 'Survey Fetch successfully (Cached)'
            });
        }

        const survey = await Survey.findById(surveyId);

        if (!survey) {
            return res.status(404).json({
                status: 'Failed',
                message: 'Survey not found',
                data: null
            });
        }

        // Cache the survey
        await cache.set(cacheKey, survey.toObject(), TTL.SURVEY_DETAIL);

        return res.status(200).json({
            status: 'Success',
            data: survey,
            message: 'Survey Fetch successfully'
        });
    } catch (error) {
        return res.status(500).json({
            status: 'Failed',
            message: 'Server Error: Unable to Fetch survey',
            data: null
        });
    }
};

// Helper function to calculate quiz score
const calculateQuizScore = (surveyForm, responses) => {
    let totalScore = 0;
    let maxPossibleScore = 0;
    const scoredResponses = [];

    // Build a map of field_id to field config for quick lookup
    const fieldMap = new Map();
    surveyForm.forEach(field => {
        const fieldId = field.field_id || field._id?.toString();
        if (fieldId) {
            fieldMap.set(fieldId, field);
        }
    });

    // Process each response
    responses.forEach(response => {
        const field = fieldMap.get(response.field_id);
        if (!field) {
            scoredResponses.push({ ...response, is_correct: null, score_earned: 0 });
            return;
        }

        const inputType = field.input_type;
        let isCorrect = null;
        let scoreEarned = 0;

        // Handle selection-based fields (radio, checkbox, select)
        if (['radio', 'checkbox', 'select'].includes(inputType) && field.user_select_options) {
            const options = field.user_select_options;

            // Calculate max possible score for this field
            const fieldMaxScore = options.reduce((max, opt) => {
                if (opt.is_correct && opt.score) {
                    return max + opt.score;
                }
                return max;
            }, 0);
            maxPossibleScore += fieldMaxScore;

            // Check if response matches correct answer(s)
            if (inputType === 'checkbox' && Array.isArray(response.value)) {
                // For checkbox, check if all correct options are selected
                const correctOptions = options.filter(opt => opt.is_correct);
                const selectedValues = response.value;

                let allCorrect = true;
                correctOptions.forEach(opt => {
                    if (selectedValues.includes(opt.value)) {
                        scoreEarned += opt.score || 0;
                    } else {
                        allCorrect = false;
                    }
                });

                // Check for incorrect selections
                selectedValues.forEach(val => {
                    const opt = options.find(o => o.value === val);
                    if (opt && !opt.is_correct) {
                        allCorrect = false;
                    }
                });

                isCorrect = allCorrect && correctOptions.length > 0;
            } else {
                // For radio/select, single selection
                const selectedOption = options.find(opt => opt.value === response.value);
                if (selectedOption) {
                    isCorrect = selectedOption.is_correct || false;
                    scoreEarned = isCorrect ? (selectedOption.score || 0) : 0;
                }
            }
        }
        // Handle text-based fields with quiz_correct_answer
        else if (field.quiz_correct_answer) {
            maxPossibleScore += field.quiz_score || 0;
            const normalizedResponse = String(response.value || '').trim().toLowerCase();
            const normalizedCorrect = String(field.quiz_correct_answer).trim().toLowerCase();
            isCorrect = normalizedResponse === normalizedCorrect;
            scoreEarned = isCorrect ? (field.quiz_score || 0) : 0;
        }

        totalScore += scoreEarned;
        scoredResponses.push({
            ...response,
            is_correct: isCorrect,
            score_earned: scoreEarned
        });
    });

    const percentageScore = maxPossibleScore > 0
        ? Math.round((totalScore / maxPossibleScore) * 100)
        : 0;

    return {
        responses: scoredResponses,
        total_score: totalScore,
        max_possible_score: maxPossibleScore,
        percentage_score: percentageScore
    };
};

const surveySubmission = async (req, res) => {
    try {
        const surveyId = req.params.id;

        const survey = await Survey.findById(surveyId);

        if (!survey) {
            return res.status(404).json({
                status: 'Failed',
                message: 'Survey not found',
                data: null
            });
        }

        // Validate Turnstile CAPTCHA if enabled
        if (survey.form_settings?.captcha_enabled) {
            const turnstileToken = req.body.turnstile_token;

            if (!turnstileToken) {
                return res.status(400).json({
                    status: 'Failed',
                    message: 'CAPTCHA verification required',
                    data: null
                });
            }

            try {
                const verifyResponse = await fetch(
                    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({
                            secret: process.env.TURNSTILE_SECRET_KEY,
                            response: turnstileToken,
                            remoteip: req.ip
                        })
                    }
                );
                const verifyResult = await verifyResponse.json();

                if (!verifyResult.success) {
                    return res.status(400).json({
                        status: 'Failed',
                        message: 'CAPTCHA verification failed',
                        data: null
                    });
                }
            } catch (error) {
                console.error('Turnstile verification error:', error);
                return res.status(500).json({
                    status: 'Failed',
                    message: 'CAPTCHA verification error',
                    data: null
                });
            }
        }

        // Check response limits
        if (survey.response_settings?.max_responses) {
            const currentResponseCount = survey.submissions?.length || 0;
            if (currentResponseCount >= survey.response_settings.max_responses) {
                return res.status(400).json({
                    status: 'Failed',
                    message: 'This survey has reached its maximum number of responses',
                    data: null
                });
            }
        }

        // Check one response per user
        if (survey.response_settings?.one_response_per_user) {
            const existingSubmission = await Submission.findOne({
                survey_id: surveyId,
                survey_answered_by: req.user._id
            });
            if (existingSubmission) {
                return res.status(400).json({
                    status: 'Failed',
                    message: 'You have already submitted a response to this survey',
                    data: null
                });
            }
        }

        // Check date restrictions
        const now = new Date();
        if (survey.response_settings?.start_date && new Date(survey.response_settings.start_date) > now) {
            return res.status(400).json({
                status: 'Failed',
                message: 'This survey is not yet open for submissions',
                data: null
            });
        }
        if (survey.response_settings?.end_date && new Date(survey.response_settings.end_date) < now) {
            return res.status(400).json({
                status: 'Failed',
                message: 'This survey has closed and is no longer accepting submissions',
                data: null
            });
        }

        const payload = req.body;
        const survey_answered_by = req.user._id;
        const survey_created_by = survey.created_by;

        // Build responses array from payload
        let responses = payload.responses || [];
        let quizResults = null;

        // Calculate quiz score if quiz mode is enabled
        if (survey.quiz_settings?.enabled && survey.survey_form) {
            quizResults = calculateQuizScore(survey.survey_form, responses);
            responses = quizResults.responses;
        }

        const updatedPayload = {
            survey_id: surveyId,
            survey_answered_by,
            survey_created_by,
            responses: responses,
            submissions: payload.submissions, // Legacy format
            total_score: quizResults?.total_score || 0,
            max_possible_score: quizResults?.max_possible_score || 0,
            percentage_score: quizResults?.percentage_score || 0,
            is_partial: payload.is_partial || false,
            current_page: payload.current_page || 0
        };

        const newSubmission = new Submission(updatedPayload);
        await newSubmission.save();

        const updatedSurvey = await Survey.findByIdAndUpdate(
            surveyId,
            { $push: { submissions: newSubmission._id } },
            { new: true, runValidators: true }
        );

        if (!updatedSurvey) {
            return res.status(404).json({
                status: 'Failed',
                message: 'Survey not found',
                data: null
            });
        }

        // Prepare response with quiz results if applicable
        const responseData = {
            submission: newSubmission,
            quiz_results: survey.quiz_settings?.enabled ? {
                total_score: quizResults?.total_score || 0,
                max_possible_score: quizResults?.max_possible_score || 0,
                percentage_score: quizResults?.percentage_score || 0,
                passed: survey.quiz_settings.passing_score
                    ? (quizResults?.percentage_score || 0) >= survey.quiz_settings.passing_score
                    : null,
                show_correct_answers: survey.quiz_settings.show_correct_answers,
                show_score_immediately: survey.quiz_settings.show_score_immediately
            } : null
        };

        return res.status(200).json({
            message: 'Submission Submitted',
            data: responseData,
            status: 'Success',
        });

    } catch (error) {
        console.log({ error })
        return res.status(500).json({
            status: 'Failed',
            message: 'Server Error: Unable to Submit',
            data: null
        });
    }
};

const getSurveySubmission = async (req, res) => {
    try {
        const surveyId = req.params.id;
        const survey = await Survey.findById(surveyId, {
            survey_title: 1,
            survey_description: 1,
            view_count: 1,
            created_by: 1

        }).lean().exec()

        if (!survey) {
            return res.status(404).json({
                status: 'Failed',
                message: 'Survey not found',
                data: null
            });
        }

        // Authorization check: Only survey creator can view submissions
        if (survey.created_by.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                status: 'Failed',
                message: 'You do not have permission to view submissions for this survey',
                data: null
            });
        }

        const surveySubmission = await Submission.find({ survey_id: surveyId });

        return res.status(200).json({
            status: 'Success',
            data: {
                ...survey,
                submissions: surveySubmission
            },
            message: 'Submission Fetch successfully'
        });
    } catch (error) {
        console.log({ error })
        return res.status(500).json({
            status: 'Failed',
            message: 'Server Error: Unable to Fetch Submission',
            data: null
        });
    }
};


// GET Available Tags API
const getAvailableTags = async (_req, res) => {
    try {
        // Try to get from cache
        const cacheKey = cache.generateKey('surveys', 'tags');
        const cached = await cache.get(cacheKey);
        if (cached) {
            return res.status(200).json({
                status: 'Success',
                data: cached,
                message: 'Tags retrieved successfully (Cached)'
            });
        }

        // Aggregate unique tags with counts from published surveys only
        const tagsAggregation = await Survey.aggregate([
            { $match: { status: 'published', access: true } },
            { $unwind: '$tags' },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
            { $limit: 50 },
            { $project: { _id: 0, tag: '$_id', count: 1 } }
        ]);

        // Cache the tags
        await cache.set(cacheKey, tagsAggregation, TTL.SURVEYS_LIST);

        return res.status(200).json({
            status: 'Success',
            data: tagsAggregation,
            message: 'Tags retrieved successfully'
        });
    } catch (error) {
        console.error('Get tags error:', error);
        return res.status(500).json({
            status: 'Failed',
            message: 'Server Error: Unable to fetch tags',
            data: null
        });
    }
};

module.exports = {
    createSurvey,
    listSurveys,
    archiveSurvey,
    unpublishSurvey,
    editSurvey,
    getSurvey,
    surveySubmission,
    getSurveySubmission,
    getAvailableTags
}
