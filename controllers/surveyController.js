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

        // Invalidate user's surveys list cache
        const surveysListKey = cache.generateKey('surveys', 'user', req.user._id);
        await cache.del(surveysListKey);

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
        // Try to get from cache
        const cacheKey = cache.generateKey('surveys', 'user', req.user._id);
        const cached = await cache.get(cacheKey);
        if (cached) {
            return res.status(200).json({
                status: 'Success',
                data: cached,
                message: 'Surveys retrieved successfully (Cached)'
            });
        }

        const surveys = await Survey.find({ created_by: req.user._id, access: true }).sort({ createdAt: -1 })
            .select('survey_title survey_description status submissions view_count createdAt')

        // Cache the surveys list
        await cache.set(cacheKey, surveys, TTL.SURVEYS_LIST);

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
        const surveysListKey = cache.generateKey('surveys', 'user', req.user._id);
        const surveyDetailKey = cache.generateKey('survey', surveyId);
        await cache.del(surveysListKey, surveyDetailKey);

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
        const surveysListKey = cache.generateKey('surveys', 'user', req.user._id);
        const surveyDetailKey = cache.generateKey('survey', surveyId);
        await cache.del(surveysListKey, surveyDetailKey);

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
        const surveysListKey = cache.generateKey('surveys', 'user', req.user._id);
        const surveyDetailKey = cache.generateKey('survey', surveyId);
        await cache.del(surveysListKey, surveyDetailKey);

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


module.exports = {
    createSurvey,
    listSurveys,
    archiveSurvey,
    unpublishSurvey,
    editSurvey,
    getSurvey,
    surveySubmission,
    getSurveySubmission
}
