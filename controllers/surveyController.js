const { default: mongoose } = require("mongoose");
const { Survey, Submission } = require("../models/surveyModel");
const { createDefaultFormSchema } = require("../utils/utils");

// CREATE Survey API
const createSurvey = async (req, res) => {
    try {
        const payload = req.body;

        // Accept BOTH naming conventions for backward compatibility:
        // - Old: survey_title, survey_description (existing code)
        // - New: title, description (new wizard)
        const title = payload.survey_title || payload.title || '';
        const description = payload.survey_description || payload.description || '';

        // Validation
        if (title.trim().length < 3) {
            return res.error({
                message: 'Survey title must be at least 3 characters long',
                code: 400
            });
        }

        // Create default form schema with the provided data
        const formSchema = createDefaultFormSchema({
            title: title.trim(),
            publicTitle: payload.publicTitle || title.trim(),
            description: description.trim(),
            multiStep: payload.multiStep || false
        });

        const newSurvey = new Survey({
            ...formSchema,
            survey_title: title.trim(),
            survey_description: description.trim(),
            created_by: req.user._id
        });

        const savedSurvey = await newSurvey.save();

        // Use responseFormatter helper for consistent format
        return res.status(201).success({
            message: 'Survey created successfully',
            data: savedSurvey
        });
    } catch (error) {
        console.error('Create survey error:', error);
        return res.error({
            message: 'Server Error: Survey not created',
            error: error.message,
            code: 500
        });
    }
}

// LIST Surveys API
const listSurveys = async (req, res) => {
    try {
        //Get pagination parameters
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;

        // Build filter object
        const filter = {
            access: true
        };

        // Only filter by user if not showing all surveys
        if (req.query.showAll !== 'true') {
            filter.created_by = req.user._id;  // Only get surveys created by the authenticated user
        }

        // Add status filter if provided
        if (req.query.status) {
            filter.status = req.query.status;
        }

        // Add search functionality
        if (req.query.search) {
            const searchRegex = { $regex: req.query.search, $options: 'i' };
            filter.$or = [
                { survey_title: searchRegex },
                { survey_description: searchRegex }
            ];
        }

        const surveys = await Survey.find(filter)
            .populate('created_by', 'public_user_name user_public_profile_pic _id')
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('survey_title survey_description status submissions view_count createdAt updatedAt created_by');

        const total = await Survey.countDocuments(filter);
        const totalPages = Math.ceil(total / limit);

        // Use responseFormatter helper for consistent format
        return res.success({
            message: 'Surveys retrieved successfully',
            data: surveys  // Direct array for frontend compatibility
        });
    } catch (error) {
        console.error('List surveys error:', error);
        return res.error({
            message: 'Unable to fetch surveys',
            error: error.message,
            code: 500
        });
    }
}

// SOFT DELETE Survey (change status)
const archiveSurvey = async (req, res) => {
    try {
        const surveyId = req.params._id;
        const survey = await Survey.findById(surveyId);

        if (!survey) {
            return res.error({
                message: 'Survey not found',
                code: 404
            });
        }

        // Soft delete by setting status to 'archived'
        survey.access = false;

        await survey.save();

        return res.success({
            message: 'Survey Deleted successfully',
            data: null
        });
    } catch (error) {
        console.error('Archive survey error:', error);
        return res.error({
            message: 'Server Error: Unable to archive survey',
            error: error.message,
            code: 500
        });
    }
}

// EDIT Survey API
const editSurvey = async (req, res) => {
    try {
        const surveyId = req.params._id;

        const survey = await Survey.findById(surveyId);

        if (!survey) {
            return res.error({
                message: 'Survey not found',
                code: 404
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
                return res.error({
                    message: 'Survey title must be at least 3 characters long',
                    code: 400
                });
            }
        }

        const updatedSurvey = await Survey.findByIdAndUpdate(surveyId, { ...updatedPayload }, { new: true })

        return res.success({
            message: 'Survey updated successfully',
            data: updatedSurvey
        });
    } catch (error) {
        console.error('Edit survey error:', error);
        return res.error({
            message: 'Server Error: Unable to update survey',
            error: error.message,
            code: 500
        });
    }
};

const getSurvey = async (req, res) => {
    try {
        const surveyId = req.params._id;

        const survey = await Survey.findById(surveyId);

        if (!survey) {
            return res.error({
                message: 'Survey not found',
                code: 404
            });
        }

        return res.success({
            message: 'Survey Fetch successfully',
            data: survey
        });
    } catch (error) {
        console.error('Get survey error:', error);
        return res.error({
            message: 'Server Error: Unable to Fetch survey',
            error: error.message,
            code: 500
        });
    }
};

const surveySubmission = async (req, res) => {
    try {
        const surveyId = req.params._id;

        const survey = await Survey.findById(surveyId);

        if (!survey) {
            return res.error({
                message: 'Survey not found',
                code: 404
            });
        }

        const payload = req.body
        const survey_answered_by = req.user._id;
        const survey_created_by = survey.created_by;

        const updatedPayload = {
            survey_id: surveyId,
            survey_answered_by,
            survey_created_by,
            submissions: payload.submissions
        }

        const newSubmission = new Submission(updatedPayload);
        await newSubmission.save();

        const updatedSurvey = await Survey.findByIdAndUpdate(
            surveyId,
            { $push: { submissions: newSubmission._id } },
            { new: true, runValidators: true }
        );

        if (!updatedSurvey) {
            return res.error({
                message: 'Survey not found',
                code: 404
            });
        }

        return res.success({
            message: 'Submission Submitted',
            data: newSubmission
        });

    } catch (error) {
        console.error('Survey submission error:', error);
        return res.error({
            message: 'Server Error: Unable to Submit',
            error: error.message,
            code: 500
        });
    }
};

const getSurveySubmission = async (req, res) => {
    try {
        const surveyId = req.params._id;

        // Add pagination support
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const survey = await Survey.findById(surveyId, {
            survey_title: 1,
            survey_description: 1,
            view_count: 1
        }).lean().exec()

        const surveySubmission = await Submission.find({ survey_id: surveyId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Submission.countDocuments({ survey_id: surveyId });

        if (!surveySubmission || !survey) {
            return res.error({
                message: 'Submission not found for the Survey',
                code: 404
            });
        }

        return res.success({
            message: 'Submission Fetch successfully',
            data: {
                ...survey,
                submissions: surveySubmission,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error('Get survey submission error:', error);
        return res.error({
            message: 'Server Error: Unable to Fetch Submission',
            error: error.message,
            code: 500
        });
    }
};

// DUPLICATE Survey
const duplicateSurvey = async (req, res) => {
    try {
        const surveyId = req.params._id;
        const survey = await Survey.findOne({
            _id: surveyId,
            $or: [
                { created_by: req.user._id },
                { user_id: req.user._id }
            ]
        });

        if (!survey) {
            return res.error({
                message: 'Survey not found or you do not have permission',
                code: 404
            });
        }

        // Create a copy of the survey
        const surveyData = survey.toObject();
        delete surveyData._id;
        delete surveyData.submissions;
        delete surveyData.createdAt;
        delete surveyData.updatedAt;
        delete surveyData.slug;

        // Update title to indicate it's a copy
        surveyData.survey_title = `${surveyData.survey_title} (Copy)`;
        surveyData.status = 'draft';
        surveyData.view_count = 0;
        if (surveyData.analytics) {
            surveyData.analytics = {
                total_views: 0,
                total_submissions: 0,
                conversion_rate: 0
            };
        }

        const newSurvey = new Survey(surveyData);
        await newSurvey.save();

        return res.success({
            message: 'Survey duplicated successfully',
            data: newSurvey
        });
    } catch (error) {
        console.error('Duplicate survey error:', error);
        return res.error({
            message: 'Server Error: Unable to duplicate survey',
            error: error.message,
            code: 500
        });
    }
};

// TOGGLE Publish Status
const togglePublishStatus = async (req, res) => {
    try {
        const surveyId = req.params._id;
        const { isPublished } = req.body;

        const survey = await Survey.findOne({
            _id: surveyId,
            $or: [
                { created_by: req.user._id },
                { user_id: req.user._id }
            ]
        });

        if (!survey) {
            return res.error({
                message: 'Survey not found or you do not have permission',
                code: 404
            });
        }

        survey.status = isPublished ? 'published' : 'draft';
        survey.access = isPublished;
        await survey.save();

        return res.success({
            message: `Survey ${isPublished ? 'published' : 'unpublished'} successfully`,
            data: survey
        });
    } catch (error) {
        console.error('Toggle publish status error:', error);
        return res.error({
            message: 'Server Error: Unable to update publish status',
            error: error.message,
            code: 500
        });
    }
};

// GET Survey Analytics
const getSurveyAnalytics = async (req, res) => {
    try {
        const surveyId = req.params._id;

        const survey = await Survey.findOne({
            _id: surveyId,
            $or: [
                { created_by: req.user._id },
                { user_id: req.user._id }
            ]
        });

        if (!survey) {
            return res.error({
                message: 'Survey not found or you do not have permission',
                code: 404
            });
        }

        const submissions = await Submission.find({ survey_id: surveyId });

        // Calculate analytics
        const analytics = {
            total_views: survey.view_count || survey.analytics?.total_views || 0,
            total_submissions: submissions.length,
            conversion_rate: 0,
            submissionsByDay: {},
            recentSubmissions: submissions.slice(-10).map(s => ({
                id: s._id,
                submittedAt: s.createdAt || s.submittedAt,
                answeredBy: s.survey_answered_by
            }))
        };

        if (analytics.total_views > 0) {
            analytics.conversion_rate = (analytics.total_submissions / analytics.total_views * 100).toFixed(2);
        }

        // Group submissions by day
        submissions.forEach(submission => {
            const date = new Date(submission.createdAt || submission.submittedAt).toISOString().split('T')[0];
            analytics.submissionsByDay[date] = (analytics.submissionsByDay[date] || 0) + 1;
        });

        return res.success({
            message: 'Analytics fetched successfully',
            data: {
                survey: {
                    id: survey?._id,
                    title: survey.survey_title,
                    status: survey.status
                },
                analytics
            }
        });
    } catch (error) {
        console.error('Get survey analytics error:', error);
        return res.error({
            message: 'Server Error: Unable to fetch analytics',
            error: error.message,
            code: 500
        });
    }
};

// Rate limiting middleware for form creation
const createFormLimit = async (req, res, next) => {
    try {
        // Get user's survey count created in last 24 hours
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentSurveys = await Survey.countDocuments({
            $or: [
                { created_by: req.user._id },
                { user_id: req.user._id }
            ],
            createdAt: { $gte: oneDayAgo }
        });

        // Limit to 50 surveys per day (configurable)
        const MAX_SURVEYS_PER_DAY = process.env.MAX_SURVEYS_PER_DAY || 50;

        if (recentSurveys >= MAX_SURVEYS_PER_DAY) {
            return res.error({
                message: `Rate limit exceeded. Maximum ${MAX_SURVEYS_PER_DAY} surveys per day.`,
                code: 429
            });
        }

        next();
    } catch (error) {
        console.error('Create form limit error:', error);
        next();
    }
};

// Rate limiting middleware for form submission
const submitFormLimit = async (req, res, next) => {
    try {
        const surveyId = req.params._id;

        // Check if user already submitted this survey in last hour
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentSubmission = await Submission.findOne({
            survey_id: surveyId,
            survey_answered_by: req.user?._id,
            createdAt: { $gte: oneHourAgo }
        });

        if (recentSubmission) {
            return res.error({
                message: 'You have already submitted this survey recently. Please try again later.',
                code: 429
            });
        }

        next();
    } catch (error) {
        console.error('Submit form limit error:', error);
        next();
    }
};


module.exports = {
    createSurvey,
    listSurveys,
    archiveSurvey,
    editSurvey,
    getSurvey,
    surveySubmission,
    getSurveySubmission,
    duplicateSurvey,
    togglePublishStatus,
    getSurveyAnalytics,
    createFormLimit,
    submitFormLimit
}