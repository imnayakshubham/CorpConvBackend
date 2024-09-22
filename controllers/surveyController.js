const { Survey, Submission } = require("../models/surveyModel");

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

// LIST Surveys API
const listSurveys = async (req, res) => {
    try {
        const surveys = await Survey.find({ created_by: req.user._id, access: true })
            .select('survey_title survey_description status submissions view_count createdAt')

        return res.status(200).json({
            status: 'Success',
            data: surveys,
            message: 'Surveys retrieved successfully'
        });
    } catch (error) {
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

        if (!survey || !survey?.access) {
            return res.status(404).json({
                status: 'Failed',
                message: 'Survey not found',
                data: null
            });
        }

        // Soft delete by setting status to 'archived'
        survey.access = false;

        await survey.save();

        return res.status(200).json({
            status: 'Success',
            data: {
                access: survey.access,
                _id: survey._id
            },
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

const getSurvey = async (req, res) => {
    try {
        const surveyId = req.params.id;

        const survey = await Survey.findById(surveyId);

        if (!survey || !survey?.access) {
            return res.status(404).json({
                status: 'Failed',
                message: 'Survey not found',
                data: null
            });
        }

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
            return res.status(404).json({
                status: 'Failed',
                message: 'Survey not found',
                data: null
            });
        }

        return res.status(200).json({
            message: 'Submission created and survey updated successfully',
            data: newSubmission,
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
            view_count: 1

        }).lean().exec()

        const surveySubmission = await Submission.find({ survey_id: surveyId });

        if (!surveySubmission || !survey) {
            return res.status(404).json({
                status: 'Failed',
                message: 'Submission not found for the Survey',
                data: null
            });
        }


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


module.exports = {
    createSurvey,
    listSurveys,
    archiveSurvey,
    editSurvey,
    getSurvey,
    surveySubmission,
    getSurveySubmission,
}