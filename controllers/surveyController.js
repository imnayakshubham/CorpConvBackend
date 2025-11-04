const { default: mongoose } = require("mongoose");
const { Survey, Submission } = require("../models/surveyModel");
const { createDefaultFormSchema } = require("../utils/utils");

// Import service layer
const conditionalLogicService = require("../services/conditionalLogicService");
const fieldTransformService = require("../services/fieldTransformService");
const formValidationService = require("../services/formValidationService");
const surveyService = require("../services/surveyService");
const submissionService = require("../services/submissionService");
const analyticsService = require("../services/analyticsService");

// CREATE Survey API
const createSurvey = async (req, res) => {
    try {
        const payload = req.body;

        // Accept BOTH naming conventions for backward compatibility:
        // - Old: survey_title, survey_description (existing code)
        // - New: title, description (new wizard)
        const title = payload.survey_title || payload.title || '';
        const description = payload.survey_description || payload.description || '';
        const internalTitle = payload.internal_title || null;

        // Validation
        if (title.trim().length < 3) {
            return res.error({
                message: 'Survey title must be at least 3 characters long',
                code: 400
            });
        }

        // Validate internal_title if provided
        if (internalTitle && internalTitle.trim().length < 3) {
            return res.error({
                message: 'Internal title must be at least 3 characters long',
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
            internal_title: internalTitle ? internalTitle.trim() : null,
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
/**
 * List Surveys - Optimized for TanStack useInfiniteQuery
 *
 * Query Parameters:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 12, max: 100)
 * - showAll: Include all surveys or just user's (default: false)
 * - status: Filter by status (draft, published, archived)
 * - search: Search in title and description
 * - sortBy: Sort field (createdAt, updatedAt, view_count, survey_title)
 * - sortOrder: Sort direction (asc, desc) - default: desc
 *
 * Response Structure (optimized for useInfiniteQuery):
 * {
 *   status: "Success",
 *   message: "Surveys retrieved successfully",
 *   data: [...surveys...],
 *   pagination: {
 *     page: 1,
 *     limit: 12,
 *     total: 100,
 *     totalPages: 9,
 *     hasMore: true,        // Key for getNextPageParam
 *     hasPrevious: false,   // Key for getPreviousPageParam
 *     count: 12,
 *     nextPage: 2,          // Explicit next page number
 *     previousPage: null
 *   }
 * }
 */
const listSurveys = async (req, res) => {
    try {
        // === PAGINATION PARAMETERS ===
        const page = Math.max(1, parseInt(req.query.page) || 1); // Ensure page >= 1
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 12)); // Default 12, max 100
        const skip = (page - 1) * limit;

        // === SORTING PARAMETERS ===
        const sortBy = req.query.sortBy || 'updatedAt';
        const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

        // Validate sortBy field (prevent NoSQL injection)
        const allowedSortFields = ['createdAt', 'updatedAt', 'view_count', 'survey_title', 'status'];
        const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'updatedAt';
        const sortOptions = { [sortField]: sortOrder };

        // === BUILD FILTER OBJECT ===
        const filter = {
            access: true
        };

        // Only filter by user if not showing all surveys
        if (req.query.showAll !== 'true') {
            // If user is not authenticated, return error for non-showAll requests
            if (!req.user || !req.user._id) {
                return res.status(401).json({
                    success: false,
                    error: 'Unauthorized',
                    message: 'Authentication required to view your surveys. Use showAll=true for public surveys.'
                });
            }
            filter.created_by = req.user._id;  // Only get surveys created by the authenticated user
        }

        // Add status filter if provided
        if (req.query.status) {
            const validStatuses = ['draft', 'published', 'archived'];
            if (validStatuses.includes(req.query.status)) {
                filter.status = req.query.status;
            }
        }

        // Add search functionality (case-insensitive)
        if (req.query.search && req.query.search.trim()) {
            const searchRegex = { $regex: req.query.search.trim(), $options: 'i' };
            filter.$or = [
                { survey_title: searchRegex },
                { survey_description: searchRegex },
                { slug: searchRegex }
            ];
        }

        // === EXECUTE QUERIES IN PARALLEL ===
        const [surveys, total] = await Promise.all([
            Survey.find(filter)
                .populate('created_by', 'public_user_name user_public_profile_pic _id')
                .sort(sortOptions)
                .skip(skip)
                .limit(limit)
                .select('survey_title survey_description status submissions view_count createdAt updatedAt created_by slug')
                .lean(), // Use lean for better performance
            Survey.countDocuments(filter)
        ]);

        // === CALCULATE PAGINATION METADATA ===
        const totalPages = Math.ceil(total / limit);
        const hasMore = page < totalPages;
        const hasPrevious = page > 1;
        const nextPage = hasMore ? page + 1 : null;
        const previousPage = hasPrevious ? page - 1 : null;

        // === RESPONSE (Optimized for TanStack useInfiniteQuery) ===
        return res.success({
            message: total === 0
                ? 'No surveys found'
                : `Surveys retrieved successfully (page ${page} of ${totalPages})`,
            data: surveys,
            pagination: {
                // Current page info
                page: page,
                limit: limit,
                count: surveys.length,

                // Total counts
                total: total,
                totalPages: totalPages,

                // Navigation flags (for useInfiniteQuery)
                hasMore: hasMore,           // Primary flag for getNextPageParam
                hasPrevious: hasPrevious,   // For getPreviousPageParam (if needed)

                // Explicit page numbers (alternative to calculating in frontend)
                nextPage: nextPage,
                previousPage: previousPage,

                // Metadata for debugging
                isFirstPage: page === 1,
                isLastPage: !hasMore,
                totalFetched: skip + surveys.length,
                remaining: Math.max(0, total - (skip + surveys.length))
            }
        });
    } catch (error) {
        console.error('List surveys error:', error);
        return res.error({
            message: 'Unable to fetch surveys',
            error: process.env.NODE_ENV === 'production' ? undefined : error.message,
            code: 500
        });
    }
}

// SOFT DELETE Survey (change status)
const archiveSurvey = async (req, res) => {
    try {
        // Support both :id and :_id params
        const surveyId = req.params.id || req.params._id;
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
        // Support both :id and :_id params
        const surveyId = req.params.id || req.params._id;

        const survey = await Survey.findById(surveyId);

        if (!survey) {
            return res.error({
                message: 'Survey not found',
                code: 404
            });
        }
        let updatedPayload = req.body;
        const payloadKeys = Object.keys(updatedPayload)

        // Handle survey_title validation and trimming
        if (payloadKeys.includes("survey_title")) {
            updatedPayload.survey_title = updatedPayload.survey_title.trim();
            if (updatedPayload.survey_title.length < 3) {
                return res.error({
                    message: 'Survey title must be at least 3 characters long',
                    code: 400
                });
            }
        }

        // Handle survey_description trimming
        if (payloadKeys.includes("survey_description")) {
            updatedPayload.survey_description = updatedPayload.survey_description.trim();
        }

        // Handle internal_title validation and trimming
        if (payloadKeys.includes("internal_title")) {
            if (updatedPayload.internal_title) {
                updatedPayload.internal_title = updatedPayload.internal_title.trim();
                if (updatedPayload.internal_title.length < 3) {
                    return res.error({
                        message: 'Internal title must be at least 3 characters long',
                        code: 400
                    });
                }
            } else {
                updatedPayload.internal_title = null;
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
        const identifier = req.params._id || req.params.id;

        // Try to find by MongoDB ID first
        let survey = null;

        // Check if it's a valid MongoDB ObjectId
        if (identifier && identifier.match(/^[0-9a-fA-F]{24}$/)) {
            survey = await Survey.findById(identifier);
        }

        // If not found by ID, try finding by slug
        if (!survey) {
            survey = await Survey.findOne({ slug: identifier });
        }

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
        // Support both :id and :_id params
        const surveyId = req.params.id || req.params._id;

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
        const surveyId = req.params.id || req.params._id;

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
        // Support both :id and :_id params
        const surveyId = req.params.id || req.params._id;

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

        // Generate unique slug with random suffix
        const baseSlug = surveyData.survey_title
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        const generateSlugWithRetry = async (base, retries = 3) => {
            for (let i = 0; i < retries; i++) {
                const randomSuffix = Math.random().toString(36).substring(2, 10);
                const slug = `${base}-${randomSuffix}`;

                // Check if slug exists
                const existing = await Survey.findOne({ slug });
                if (!existing) {
                    return slug;
                }
            }
            // Final attempt with timestamp as fallback
            return `${base}-${Date.now()}`;
        };

        surveyData.slug = await generateSlugWithRetry(baseSlug);

        // Save with retry logic for duplicate key errors
        try {
            const newSurvey = new Survey(surveyData);
            await newSurvey.save();

            return res.success({
                message: 'Survey duplicated successfully',
                data: newSurvey
            });
        } catch (saveError) {
            // Handle duplicate key error
            if (saveError.code === 11000 && saveError.keyPattern?.slug) {
                // Regenerate slug and retry once
                surveyData.slug = await generateSlugWithRetry(baseSlug);
                const newSurvey = new Survey(surveyData);
                await newSurvey.save();

                return res.success({
                    message: 'Survey duplicated successfully',
                    data: newSurvey
                });
            }
            throw saveError;
        }
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
        const surveyId = req.params.id || req.params._id;
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
        const surveyId = req.params.id || req.params._id;

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
        const surveyId = req.params.id || req.params._id;

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

// ============ NEW CONTROLLER METHODS USING SERVICE LAYER ============

// Evaluate Conditional Logic
const evaluateConditionalLogic = async (req, res) => {
    try {
        const surveyId = req.params.id;
        const formData = req.body.formData || {};

        const survey = await Survey.findById(surveyId);
        if (!survey) {
            return res.error({
                message: 'Survey not found',
                code: 404
            });
        }

        // Use service to evaluate logic
        const fieldStates = conditionalLogicService.getFieldStates(survey, formData);
        const visibleFields = conditionalLogicService.getVisibleFields(survey, formData);
        const requiredFields = conditionalLogicService.getRequiredFields(survey, formData);

        return res.success({
            message: 'Conditional logic evaluated successfully',
            data: {
                fieldStates,
                visibleFields,
                requiredFields
            }
        });
    } catch (error) {
        console.error('Evaluate conditional logic error:', error);
        return res.error({
            message: 'Failed to evaluate conditional logic',
            error: error.message,
            code: 500
        });
    }
};

// Transform Field Data
const transformFieldData = async (req, res) => {
    try {
        const surveyId = req.params.id;
        const { fieldId, value } = req.body;

        const survey = await Survey.findById(surveyId);
        if (!survey) {
            return res.error({
                message: 'Survey not found',
                code: 404
            });
        }

        const field = survey.survey_form.find(f =>
            (f._id && f._id.toString() === fieldId) || f.id === fieldId
        );

        if (!field) {
            return res.error({
                message: 'Field not found',
                code: 404
            });
        }

        const fieldType = field.type || field.input_type;
        const transformedValue = fieldTransformService.transformByType(fieldType, value, field);

        return res.success({
            message: 'Field data transformed successfully',
            data: {
                fieldId,
                originalValue: value,
                transformedValue,
                fieldType
            }
        });
    } catch (error) {
        console.error('Transform field data error:', error);
        return res.error({
            message: 'Failed to transform field data',
            error: error.message,
            code: 500
        });
    }
};

// Validate Form Schema
const validateFormSchema = async (req, res) => {
    try {
        const schema = req.body;

        const validation = formValidationService.validateFormSchema(schema);

        if (!validation.valid) {
            return res.status(400).error({
                message: 'Form schema validation failed',
                errors: validation.errors,
                code: 400
            });
        }

        return res.success({
            message: 'Form schema is valid',
            data: { valid: true }
        });
    } catch (error) {
        console.error('Validate form schema error:', error);
        return res.error({
            message: 'Failed to validate form schema',
            error: error.message,
            code: 500
        });
    }
};

// Enhanced Submission with Service Layer
const submitSurveyWithServices = async (req, res) => {
    try {
        const surveyId = req.params.id;
        const submissionData = req.body.submissions || req.body.data;

        const survey = await Survey.findById(surveyId);
        if (!survey) {
            return res.error({
                message: 'Survey not found',
                code: 404
            });
        }

        // Prepare metadata
        const metadata = {
            userId: req.user?._id,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            sessionId: req.body.sessionId,
            source: req.body.source || 'web'
        };

        // Use submission service to process
        const submission = await submissionService.processSubmission(
            survey,
            submissionData,
            metadata
        );

        // Check for spam
        const spamCheck = await submissionService.detectSpam(submission);
        if (spamCheck.isSpam) {
            submission.isSpam = true;
            submission.spamScore = spamCheck.spamScore;
            await submission.save();
        }

        return res.success({
            message: 'Submission processed successfully',
            data: submission
        });
    } catch (error) {
        console.error('Submit survey with services error:', error);
        return res.error({
            message: 'Failed to process submission',
            error: error.message,
            code: 500
        });
    }
};

// Get Enhanced Analytics
const getEnhancedAnalytics = async (req, res) => {
    try {
        const surveyId = req.params.id;
        const options = {
            startDate: req.query.startDate,
            endDate: req.query.endDate
        };

        const analytics = await analyticsService.getAnalytics(surveyId, options);
        if (!analytics) {
            return res.error({
                message: 'Survey not found',
                code: 404
            });
        }

        // Get field-level analytics
        const fieldAnalytics = await analyticsService.getFieldAnalytics(surveyId);

        return res.success({
            message: 'Analytics retrieved successfully',
            data: {
                ...analytics,
                fieldAnalytics
            }
        });
    } catch (error) {
        console.error('Get enhanced analytics error:', error);
        return res.error({
            message: 'Failed to retrieve analytics',
            error: error.message,
            code: 500
        });
    }
};

// Export Submissions
const exportSubmissions = async (req, res) => {
    try {
        const surveyId = req.params.id;
        const format = req.query.format || 'json';
        const includeSpam = req.query.includeSpam === 'true';

        // Verify ownership
        const isOwner = await surveyService.checkOwnership(surveyId, req.user._id);
        if (!isOwner) {
            return res.error({
                message: 'Unauthorized: You do not own this survey',
                code: 403
            });
        }

        const data = await submissionService.exportSubmissions(surveyId, format, {
            includeSpam
        });

        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="survey-${surveyId}-submissions.csv"`);
            return res.send(data);
        }

        return res.success({
            message: 'Submissions exported successfully',
            data: data
        });
    } catch (error) {
        console.error('Export submissions error:', error);
        return res.error({
            message: 'Failed to export submissions',
            error: error.message,
            code: 500
        });
    }
};

/**
 * Get user's survey statistics
 * GET /api/survey/stats
 */
const getUserSurveyStats = async (req, res) => {
    try {
        const userId = req.user._id;

        // Get all surveys for the user
        const surveys = await Survey.find({ created_by: userId });

        // Calculate basic counts
        const totalForms = surveys.length;
        const publishedForms = surveys.filter(s => s.status === 'published').length;
        const draftForms = surveys.filter(s => s.status === 'draft').length;
        const archivedForms = surveys.filter(s => s.status === 'archived').length;

        // Calculate engagement metrics
        const totalViews = surveys.reduce((sum, s) => sum + (s.view_count || 0), 0);
        const totalSubmissions = surveys.reduce((sum, s) => sum + (s.submissions?.length || 0), 0);

        // Calculate conversion rates
        const conversions = surveys.map(s => {
            const views = s.view_count || 0;
            const subs = s.submissions?.length || 0;
            return views > 0 ? (subs / views) * 100 : 0;
        }).filter(c => c > 0);

        const avgConversionRate = conversions.length > 0
            ? conversions.reduce((sum, c) => sum + c, 0) / conversions.length
            : 0;

        // Calculate time-based trends
        const now = new Date();
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        // Get submissions count for this week and month
        const Submission = require('../models/Submission');
        const formIds = surveys.map(s => s._id);

        const submissionsThisWeek = await Submission.countDocuments({
            form_id: { $in: formIds },
            createdAt: { $gte: oneWeekAgo }
        });

        const submissionsThisMonth = await Submission.countDocuments({
            form_id: { $in: formIds },
            createdAt: { $gte: oneMonthAgo }
        });

        // Get recent activity (last 7 days of submissions)
        const recentSubmissions = await Submission.aggregate([
            {
                $match: {
                    form_id: { $in: formIds },
                    createdAt: { $gte: oneWeekAgo }
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        // Get most viewed forms (top 5)
        const mostViewedForms = surveys
            .filter(s => s.view_count > 0)
            .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
            .slice(0, 5)
            .map(s => ({
                id: s._id,
                title: s.survey_title,
                views: s.view_count,
                submissions: s.submissions?.length || 0,
                conversionRate: s.view_count > 0
                    ? ((s.submissions?.length || 0) / s.view_count * 100).toFixed(2)
                    : 0
            }));

        return res.success({
            message: 'Survey statistics retrieved successfully',
            data: {
                // Basic counts
                totalForms,
                publishedForms,
                draftForms,
                archivedForms,

                // Engagement metrics
                totalViews,
                totalSubmissions,

                // Conversion & performance
                avgConversionRate: avgConversionRate.toFixed(2),

                // Time-based trends
                submissionsThisWeek,
                submissionsThisMonth,
                recentActivity: recentSubmissions,

                // Top performers
                mostViewedForms
            }
        });
    } catch (error) {
        console.error('Error fetching survey statistics:', error);
        return res.error({
            message: 'Failed to fetch survey statistics',
            error: error.message,
            code: 500
        });
    }
};

/**
 * Track form view (public endpoint)
 * POST /api/survey/:id/view
 */
const trackFormView = async (req, res) => {
    try {
        const { id } = req.params;

        // Find survey by ID or slug
        let survey = await Survey.findById(id);
        if (!survey) {
            survey = await Survey.findOne({ slug: id });
        }

        if (!survey) {
            return res.error({
                message: 'Survey not found',
                code: 404
            });
        }

        // Increment view count
        await survey.incrementViewCount();

        return res.success({
            message: 'View tracked successfully',
            data: {
                view_count: survey.view_count
            }
        });
    } catch (error) {
        console.error('Error tracking form view:', error);
        return res.error({
            message: 'Failed to track view',
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
    getSurveySubmission,
    duplicateSurvey,
    togglePublishStatus,
    getSurveyAnalytics,
    getUserSurveyStats,
    createFormLimit,
    submitFormLimit,
    trackFormView,
    // New methods using service layer
    evaluateConditionalLogic,
    transformFieldData,
    validateFormSchema,
    submitSurveyWithServices,
    getEnhancedAnalytics,
    exportSubmissions
}