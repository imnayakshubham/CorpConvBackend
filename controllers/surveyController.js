const { default: mongoose } = require("mongoose");
const { Survey, Submission } = require("../models/surveyModel");

// CREATE Survey API
const createSurvey = async (req, res) => {
    try {
        const payload = req.body;

        // Accept BOTH naming conventions for backward compatibility:
        // - Old: survey_title, survey_description (existing code)
        // - New: title, description (new wizard)
        const title = payload.survey_title || payload.title || '';
        const description = payload.survey_description || payload.description || '';

        const updatedPayload = {
            survey_title: title.trim(),
            survey_description: description.trim(),
            created_by: req.user._id
        }

        // Validation
        if (updatedPayload.survey_title.length < 3) {
            return res.error({
                message: 'Survey title must be at least 3 characters long',
                code: 400
            });
        }

        const newSurvey = new Survey({
            ...updatedPayload,
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
        const surveyId = req.params.id;
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
        const surveyId = req.params.id;

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
        const surveyId = req.params.id;

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
        const surveyId = req.params.id;

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
        const surveyId = req.params.id;
        const survey = await Survey.findById(surveyId, {
            survey_title: 1,
            survey_description: 1,
            view_count: 1

        }).lean().exec()

        const surveySubmission = await Submission.find({ survey_id: surveyId });

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
                submissions: surveySubmission
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


module.exports = {
    createSurvey,
    listSurveys,
    archiveSurvey,
    editSurvey,
    getSurvey,
    surveySubmission,
    getSurveySubmission
}