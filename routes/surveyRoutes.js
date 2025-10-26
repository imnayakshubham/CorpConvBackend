const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { authenticateToken, optionalAuth } = require("../middleware/auth");
const { body, param, query, validationResult } = require('express-validator');

const {
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
    submitFormLimit,
    evaluateConditionalLogic,
    transformFieldData,
    validateFormSchema,
    submitSurveyWithServices,
    getEnhancedAnalytics,
    exportSubmissions
} = require("../controllers/surveyController");

// ============ VALIDATION MIDDLEWARE ============

// Validation middleware helper
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: errors.array()
        });
    }
    next();
};

// Validation rules that work with both old and new formats
const validateSurveyCreate = [
    body(['survey_title', 'title'])
        .optional()
        .trim()
        .isLength({ min: 3, max: 100 })
        .withMessage('Title must be between 3 and 100 characters'),
    body('internal_title')
        .optional()
        .trim()
        .isLength({ min: 3, max: 100 })
        .withMessage('Internal title must be between 3 and 100 characters'),
    body(['survey_description', 'description'])
        .optional()
        .trim()
        .isLength({ max: 1000 })
        .withMessage('Description must be less than 1000 characters'),
    body(['survey_form', 'fields'])
        .optional()
        .isArray()
        .withMessage('Fields must be an array'),
    body('status')
        .optional()
        .isIn(['draft', 'published', 'archived'])
        .withMessage('Invalid status'),
    // Custom validation to ensure at least one title field is present
    body()
        .custom((value) => {
            if (!value.survey_title && !value.title) {
                throw new Error('Title is required (survey_title or title)');
            }
            return true;
        })
];

const validateSubmission = [
    body(['submissions', 'data'])
        .custom((value) => {
            if (!value) {
                throw new Error('Submission data is required (submissions or data)');
            }
            return true;
        }),
    body('sessionId')
        .optional()
        .isString()
        .withMessage('Session ID must be a string')
];

// ============ LEGACY ROUTES (Backward Compatible) ============

// CREATE Survey - Legacy endpoint
router.post("/create-survey",
    protect,
    createFormLimit,
    createSurvey
);

// LIST Surveys - Legacy endpoint
// Uses optionalAuth to allow public access when showAll=true
router.get("/survey-list",
    optionalAuth,
    listSurveys
);

// EDIT Survey - Legacy endpoint
router.put("/edit/:id",
    protect,
    [
        param('id').isMongoId().withMessage('Invalid survey ID'),
        handleValidationErrors
    ],
    editSurvey
);

// SUBMIT Survey - Legacy endpoint
router.post("/submission/:id",
    protect,
    submitFormLimit,
    surveySubmission
);

// GET Submissions - Legacy endpoint
router.get("/submissions/:id",
    protect,
    getSurveySubmission
);

// ============ ORIGINAL ROUTES (forms.js backward compatible) ============

// CREATE Survey - supports both old and new format
router.post('/create',
    authenticateToken,
    createFormLimit,
    validateSurveyCreate,
    handleValidationErrors,
    createSurvey
);

// LIST Surveys - enhanced with optional pagination info
// Uses optionalAuth to allow public access when showAll=true
router.get('/list',
    optionalAuth,
    [
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('status').optional().isIn(['draft', 'published', 'archived']),
        query('showAll').optional().isBoolean(),
        query('search').optional().isString(),
        query('sortBy').optional().isIn(['title', 'views', 'submissions', 'created', 'updated']),
        query('sortOrder').optional().isIn(['asc', 'desc']),
        handleValidationErrors
    ],
    listSurveys
);

// GET single survey by ID
router.get('/get/:id',
    authenticateToken,
    [
        param('id').isString().withMessage('Invalid survey ID'),
        handleValidationErrors
    ],
    getSurvey
);

// EDIT Survey - supports both field formats
router.put('/edit/:id',
    authenticateToken,
    [
        param('id').isMongoId().withMessage('Invalid survey ID'),
        ...validateSurveyCreate,
        handleValidationErrors
    ],
    editSurvey
);

// ARCHIVE Survey (soft delete)
router.delete('/archive/:id',
    authenticateToken,
    [
        param('id').isMongoId().withMessage('Invalid survey ID'),
        handleValidationErrors
    ],
    archiveSurvey
);

// SUBMIT Survey Response
router.post('/submit/:id',
    authenticateToken,
    submitFormLimit,
    [
        param('id').isMongoId().withMessage('Invalid survey ID'),
        ...validateSubmission,
        handleValidationErrors
    ],
    surveySubmission
);

// GET Survey Submissions
router.get('/submissions/:id',
    authenticateToken,
    [
        param('id').isMongoId().withMessage('Invalid survey ID'),
        handleValidationErrors
    ],
    getSurveySubmission
);

// ============ NEW ROUTES (RESTful format for new implementations) ============

// GET /api/survey - List surveys (RESTful version)
router.get("/",
    protect,
    [
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('status').optional().isIn(['draft', 'published', 'archived']),
        handleValidationErrors
    ],
    async (req, res) => {
        // Set flag to include pagination in response
        req.query.includePagination = 'true';
        return listSurveys(req, res);
    }
);

// POST /api/survey - Create survey (RESTful version)
router.post("/",
    protect,
    createFormLimit,
    validateSurveyCreate,
    handleValidationErrors,
    createSurvey
);

// ============ NEW ENHANCED FEATURES ============

// GET /api/survey/slug/:slug - Get survey by slug (public access)
router.get('/slug/:slug',
    optionalAuth, // Optional auth for public forms
    [
        param('slug').isString().isLength({ min: 1 }).withMessage('Invalid slug'),
        handleValidationErrors
    ],
    async (req, res) => {
        // Override the ID param with slug for getSurvey function
        req.params._id = req.params.slug;
        return getSurvey(req, res);
    }
);

// POST /api/survey/:id/duplicate - Duplicate a survey
router.post('/:id/duplicate',
    authenticateToken,
    [
        param('id').isMongoId().withMessage('Invalid survey ID'),
        handleValidationErrors
    ],
    duplicateSurvey
);

// PUT /api/survey/:id/publish - Toggle publish status
router.put('/:id/publish',
    authenticateToken,
    [
        param('id').isMongoId().withMessage('Invalid survey ID'),
        body('isPublished').isBoolean().withMessage('isPublished must be a boolean'),
        handleValidationErrors
    ],
    togglePublishStatus
);

// GET /api/survey/:id/analytics - Get survey analytics
router.get('/:id/analytics',
    authenticateToken,
    [
        param('id').isMongoId().withMessage('Invalid survey ID'),
        handleValidationErrors
    ],
    getSurveyAnalytics
);

// ============ SERVICE-BASED ENHANCED FEATURES ============

// POST /api/survey/:id/evaluate-logic - Evaluate conditional logic for a form
router.post('/:id/evaluate-logic',
    optionalAuth,  // Optional auth for public forms
    [
        param('id').isMongoId().withMessage('Invalid survey ID'),
        body('formData').isObject().withMessage('Form data must be an object'),
        handleValidationErrors
    ],
    evaluateConditionalLogic
);

// POST /api/survey/:id/transform-field - Transform a field value
router.post('/:id/transform-field',
    optionalAuth,
    [
        param('id').isMongoId().withMessage('Invalid survey ID'),
        body('fieldType').isString().withMessage('Field type is required'),
        body('value').exists().withMessage('Value is required'),
        body('fieldConfig').optional().isObject(),
        handleValidationErrors
    ],
    transformFieldData
);

// POST /api/survey/validate-schema - Validate form schema
router.post('/validate-schema',
    authenticateToken,
    [
        body('schema').isObject().withMessage('Schema must be an object'),
        handleValidationErrors
    ],
    validateFormSchema
);

// POST /api/survey/:id/submit-enhanced - Submit with spam detection and services
router.post('/:id/submit-enhanced',
    optionalAuth,
    submitFormLimit,
    [
        param('id').isMongoId().withMessage('Invalid survey ID'),
        body('submissionData').isObject().withMessage('Submission data is required'),
        body('metadata').optional().isObject(),
        handleValidationErrors
    ],
    submitSurveyWithServices
);

// GET /api/survey/:id/analytics-enhanced - Get enhanced analytics with field-level data
router.get('/:id/analytics-enhanced',
    authenticateToken,
    [
        param('id').isMongoId().withMessage('Invalid survey ID'),
        query('startDate').optional().isISO8601().withMessage('Invalid start date'),
        query('endDate').optional().isISO8601().withMessage('Invalid end date'),
        handleValidationErrors
    ],
    getEnhancedAnalytics
);

// GET /api/survey/:id/export-submissions - Export submissions in various formats
router.get('/:id/export-submissions',
    authenticateToken,
    [
        param('id').isMongoId().withMessage('Invalid survey ID'),
        query('format').optional().isIn(['json', 'csv']).withMessage('Invalid format (json or csv)'),
        query('includeSpam').optional().isBoolean().withMessage('includeSpam must be boolean'),
        handleValidationErrors
    ],
    exportSubmissions
);

// ============ SUBMISSION MANAGEMENT (Consolidated from submissions.js) ============

// Note: These routes provide detailed submission management capabilities.
// They complement the basic submission endpoints above with advanced features like
// spam management, individual submission operations, and detailed statistics.

// GET /api/survey/submissions/:formId/detailed - Get detailed submissions with stats
router.get('/submissions/:formId/detailed',
    authenticateToken,
    [
        param('formId').isMongoId().withMessage('Invalid form ID'),
        query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
        query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
        query('includeSpam').optional().isBoolean().withMessage('includeSpam must be a boolean'),
        handleValidationErrors
    ],
    async (req, res) => {
        try {
            const Submission = require('../models/Submission');
            const { Survey } = require('../models/surveyModel');

            const { formId } = req.params;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const skip = (page - 1) * limit;
            const includeSpam = req.query.includeSpam === 'true';

            // Check if survey exists and user owns it
            const survey = await Survey.findOne({
                _id: formId,
                $or: [
                    { created_by: req.user._id },
                    { user_id: req.user._id }
                ]
            });

            if (!survey) {
                return res.status(404).json({
                    success: false,
                    error: 'Survey not found or access denied'
                });
            }

            // Build filter
            const filter = {
                $or: [{ survey_id: formId }, { formId }]
            };
            if (!includeSpam) {
                filter.isSpam = { $ne: true };
            }

            const submissions = await Submission.find(filter)
                .sort({ submittedAt: -1 })
                .skip(skip)
                .limit(limit)
                .select('-__v');

            const total = await Submission.countDocuments(filter);
            const totalPages = Math.ceil(total / limit);

            // Get submission statistics
            const stats = await Submission.aggregate([
                { $match: filter },
                {
                    $group: {
                        _id: null,
                        total_submissions: { $sum: 1 },
                        validSubmissions: {
                            $sum: { $cond: [{ $eq: ['$isValid', true] }, 1, 0] }
                        },
                        spamSubmissions: {
                            $sum: { $cond: [{ $eq: ['$isSpam', true] }, 1, 0] }
                        },
                        avgCompletionTime: { $avg: '$completionTime' }
                    }
                }
            ]);

            res.json({
                success: true,
                data: {
                    submissions,
                    pagination: {
                        page,
                        limit,
                        total,
                        totalPages,
                        hasNext: page < totalPages,
                        hasPrev: page > 1
                    },
                    statistics: stats[0] || {
                        total_submissions: 0,
                        validSubmissions: 0,
                        spamSubmissions: 0,
                        avgCompletionTime: 0
                    }
                }
            });
        } catch (error) {
            console.error('Error fetching detailed submissions:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch submissions'
            });
        }
    }
);

// GET /api/survey/submission/single/:id - Get a specific submission by ID
router.get('/submission/single/:id',
    authenticateToken,
    [
        param('id').isMongoId().withMessage('Invalid submission ID'),
        handleValidationErrors
    ],
    async (req, res) => {
        try {
            const Submission = require('../models/Submission');
            const { Survey } = require('../models/surveyModel');

            const submission = await Submission.findById(req.params.id)
                .select('-__v');

            if (!submission) {
                return res.status(404).json({
                    success: false,
                    error: 'Submission not found'
                });
            }

            // Verify ownership
            const surveyId = submission.survey_id || submission.formId;
            const survey = await Survey.findOne({
                _id: surveyId,
                $or: [
                    { created_by: req.user._id },
                    { user_id: req.user._id }
                ]
            });

            if (!survey) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied'
                });
            }

            res.json({
                success: true,
                data: submission
            });
        } catch (error) {
            console.error('Error fetching submission:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch submission'
            });
        }
    }
);

// DELETE /api/survey/submission/single/:id - Delete a specific submission
router.delete('/submission/single/:id',
    authenticateToken,
    [
        param('id').isMongoId().withMessage('Invalid submission ID'),
        handleValidationErrors
    ],
    async (req, res) => {
        try {
            const Submission = require('../models/Submission');
            const { Survey } = require('../models/surveyModel');

            const submission = await Submission.findById(req.params.id);

            if (!submission) {
                return res.status(404).json({
                    success: false,
                    error: 'Submission not found'
                });
            }

            // Verify ownership
            const surveyId = submission.survey_id || submission.formId;
            const survey = await Survey.findOne({
                _id: surveyId,
                $or: [
                    { created_by: req.user._id },
                    { user_id: req.user._id }
                ]
            });

            if (!survey) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied'
                });
            }

            await submission.deleteOne();

            res.json({
                success: true,
                message: 'Submission deleted successfully'
            });
        } catch (error) {
            console.error('Error deleting submission:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete submission'
            });
        }
    }
);

// POST /api/survey/submission/single/:id/mark-spam - Mark submission as spam
router.post('/submission/single/:id/mark-spam',
    authenticateToken,
    [
        param('id').isMongoId().withMessage('Invalid submission ID'),
        handleValidationErrors
    ],
    async (req, res) => {
        try {
            const Submission = require('../models/Submission');
            const { Survey } = require('../models/surveyModel');

            const submission = await Submission.findById(req.params.id);

            if (!submission) {
                return res.status(404).json({
                    success: false,
                    error: 'Submission not found'
                });
            }

            // Verify ownership
            const surveyId = submission.survey_id || submission.formId;
            const survey = await Survey.findOne({
                _id: surveyId,
                $or: [
                    { created_by: req.user._id },
                    { user_id: req.user._id }
                ]
            });

            if (!survey) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied'
                });
            }

            submission.isSpam = true;
            submission.spamScore = 100;
            await submission.save();

            res.json({
                success: true,
                data: submission,
                message: 'Submission marked as spam'
            });
        } catch (error) {
            console.error('Error marking submission as spam:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to mark submission as spam'
            });
        }
    }
);

// POST /api/survey/submission/single/:id/unmark-spam - Unmark submission as spam
router.post('/submission/single/:id/unmark-spam',
    authenticateToken,
    [
        param('id').isMongoId().withMessage('Invalid submission ID'),
        handleValidationErrors
    ],
    async (req, res) => {
        try {
            const Submission = require('../models/Submission');
            const { Survey } = require('../models/surveyModel');

            const submission = await Submission.findById(req.params.id);

            if (!submission) {
                return res.status(404).json({
                    success: false,
                    error: 'Submission not found'
                });
            }

            // Verify ownership
            const surveyId = submission.survey_id || submission.formId;
            const survey = await Survey.findOne({
                _id: surveyId,
                $or: [
                    { created_by: req.user._id },
                    { user_id: req.user._id }
                ]
            });

            if (!survey) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied'
                });
            }

            submission.isSpam = false;
            submission.spamScore = 0;
            await submission.save();

            res.json({
                success: true,
                data: submission,
                message: 'Submission unmarked as spam'
            });
        } catch (error) {
            console.error('Error unmarking submission as spam:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to unmark submission as spam'
            });
        }
    }
);

// GET /api/survey/:id/verify-ownership - Verify survey ownership
router.get('/:id/verify-ownership',
    authenticateToken,
    [
        param('id').isMongoId().withMessage('Invalid survey ID'),
        handleValidationErrors
    ],
    async (req, res) => {
        try {
            const { Survey } = require('../models/surveyModel');
            const survey = await Survey.findOne({
                _id: req.params._id,
                $or: [
                    { created_by: req.user._id },
                    { user_id: req.user._id }
                ]
            }).select('_id');

            return res.json({
                success: true,
                data: {
                    isOwner: !!survey
                }
            });
        } catch (error) {
            console.error('Error verifying survey ownership:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to verify ownership'
            });
        }
    }
);

// ============ BULK OPERATIONS (New Features) ============

// POST /api/survey/bulk/delete - Bulk delete surveys
router.post('/bulk/delete',
    authenticateToken,
    [
        body('surveyIds').isArray().withMessage('Survey IDs must be an array'),
        body('surveyIds.*').isMongoId().withMessage('Invalid survey ID in array'),
        handleValidationErrors
    ],
    async (req, res) => {
        try {
            const { surveyIds } = req.body;
            const { Survey } = require('../models/surveyModel');

            // Only delete surveys owned by the user
            const result = await Survey.updateMany(
                {
                    _id: { $in: surveyIds },
                    $or: [
                        { created_by: req.user._id },
                        { user_id: req.user._id }
                    ]
                },
                {
                    status: 'archived',
                    access: false
                }
            );

            return res.json({
                success: true,
                message: `${result.modifiedCount} surveys archived successfully`,
                data: {
                    modified: result.modifiedCount,
                    requested: surveyIds.length
                }
            });
        } catch (error) {
            console.error('Bulk delete error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to archive surveys'
            });
        }
    }
);

// POST /api/survey/bulk/update-status - Bulk update survey status
router.post('/bulk/update-status',
    authenticateToken,
    [
        body('surveyIds').isArray().withMessage('Survey IDs must be an array'),
        body('surveyIds.*').isMongoId().withMessage('Invalid survey ID in array'),
        body('status').isIn(['draft', 'published', 'archived']).withMessage('Invalid status'),
        handleValidationErrors
    ],
    async (req, res) => {
        try {
            const { surveyIds, status } = req.body;
            const { Survey } = require('../models/surveyModel');

            const updateData = { status };
            if (status === 'published') {
                updateData.access = true;
            } else if (status === 'archived') {
                updateData.access = false;
            }

            const result = await Survey.updateMany(
                {
                    _id: { $in: surveyIds },
                    $or: [
                        { created_by: req.user._id },
                        { user_id: req.user._id }
                    ]
                },
                updateData
            );

            return res.json({
                success: true,
                message: `${result.modifiedCount} surveys updated successfully`,
                data: {
                    modified: result.modifiedCount,
                    requested: surveyIds.length,
                    newStatus: status
                }
            });
        } catch (error) {
            console.error('Bulk update status error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to update survey status'
            });
        }
    }
);

// ============ EXPORT/IMPORT FEATURES ============

// GET /api/survey/:id/export - Export survey structure
router.get('/:id/export',
    authenticateToken,
    [
        param('id').isMongoId().withMessage('Invalid survey ID'),
        query('format').optional().isIn(['json', 'csv']).withMessage('Invalid format'),
        handleValidationErrors
    ],
    async (req, res) => {
        try {
            const { Survey } = require('../models/surveyModel');
            const { Submission } = require('../models/surveyModel');
            const survey = await Survey.findOne({
                _id: req.params._id,
                $or: [
                    { created_by: req.user._id },
                    { user_id: req.user._id }
                ]
            });

            if (!survey) {
                return res.status(404).json({
                    success: false,
                    error: 'Survey not found'
                });
            }

            const format = req.query.format || 'json';

            if (format === 'json') {
                // Remove sensitive data before export
                const exportData = survey.toObject();
                delete exportData._id;
                delete exportData.submissions;
                delete exportData.created_by;
                delete exportData.user_id;
                delete exportData.__v;

                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition',
                    `attachment; filename="survey-${survey.slug || survey?._id}.json"`);

                return res.json(exportData);
            } else if (format === 'csv') {
                // Export submissions as CSV
                const submissions = await Submission.find({ survey_id: req.params._id });

                // Convert to CSV format (simplified example)
                const csv = submissions.map(sub => {
                    return JSON.stringify(sub.submissions);
                }).join('\n');

                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition',
                    `attachment; filename="submissions-${survey.slug || survey?._id}.csv"`);

                return res.send(csv);
            }
        } catch (error) {
            console.error('Export error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to export survey'
            });
        }
    }
);

// POST /api/survey/import - Import survey structure
router.post('/import',
    authenticateToken,
    [
        body('surveyData').isObject().withMessage('Survey data must be an object'),
        handleValidationErrors
    ],
    async (req, res) => {
        try {
            const { Survey } = require('../models/surveyModel');
            const importData = req.body.surveyData;

            // Add user ownership
            importData.created_by = req.user._id;
            importData.user_id = req.user._id;

            // Reset some fields
            delete importData._id;
            delete importData.slug;
            importData.submissions = [];
            importData.status = 'draft';
            importData.view_count = 0;
            if (importData.analytics) {
                importData.analytics = {
                    total_views: 0,
                    total_submissions: 0,
                    conversion_rate: 0
                };
            }

            // Add (Imported) to title
            if (importData.survey_title) {
                importData.survey_title = `${importData.survey_title} (Imported)`;
            }

            const newSurvey = new Survey(importData);
            await newSurvey.save();

            return res.status(201).json({
                success: true,
                message: 'Survey imported successfully',
                data: newSurvey
            });
        } catch (error) {
            console.error('Import error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to import survey',
                details: error.message
            });
        }
    }
);

// ============ TEMPLATE FEATURES ============

// GET /api/survey/templates/list - Get survey templates
router.get('/templates/list',
    [
        query('category').optional().isString(),
        handleValidationErrors
    ],
    async (req, res) => {
        try {
            // Return predefined templates
            const templates = [
                {
                    id: 'customer-feedback',
                    name: 'Customer Feedback',
                    category: 'feedback',
                    description: 'Gather customer satisfaction feedback',
                    fields: [
                        {
                            type: 'radio',
                            label: 'How satisfied are you with our service?',
                            options: ['Very Satisfied', 'Satisfied', 'Neutral', 'Dissatisfied', 'Very Dissatisfied'],
                            required: true
                        },
                        {
                            type: 'textarea',
                            label: 'Additional comments',
                            placeholder: 'Tell us more...',
                            required: false
                        }
                    ]
                },
                {
                    id: 'event-registration',
                    name: 'Event Registration',
                    category: 'registration',
                    description: 'Collect event registration information',
                    fields: [
                        {
                            type: 'text',
                            label: 'Full Name',
                            required: true
                        },
                        {
                            type: 'email',
                            label: 'Email Address',
                            required: true
                        },
                        {
                            type: 'phone',
                            label: 'Phone Number',
                            required: false
                        }
                    ]
                }
            ];

            const filteredTemplates = req.query.category ?
                templates.filter(t => t.category === req.query.category) :
                templates;

            return res.json({
                success: true,
                data: filteredTemplates
            });
        } catch (error) {
            console.error('Get templates error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch templates'
            });
        }
    }
);

// POST /api/survey/from-template - Create survey from template
router.post('/from-template',
    authenticateToken,
    [
        body('templateId').isString().withMessage('Template ID is required'),
        body('title').optional().isString(),
        handleValidationErrors
    ],
    async (req, res) => {
        try {
            // This would fetch the template and create a survey
            // For now, we'll create a basic survey based on templateId
            req.body.survey_title = req.body.title || `New Survey from Template`;
            req.body.status = 'draft';

            // Add template fields based on templateId
            // This is simplified - you'd normally fetch from a templates collection

            return createSurvey(req, res);
        } catch (error) {
            console.error('Create from template error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to create survey from template'
            });
        }
    }
);

// ============ DYNAMIC :id ROUTES (Must come after specific routes) ============

// GET /api/survey/:id - Get specific survey (RESTful)
router.get("/:id",
    getSurvey
);

// PUT /api/survey/:id - Update survey (RESTful)
router.put("/:id",
    protect,
    [
        param('id').isMongoId().withMessage('Invalid survey ID'),
        handleValidationErrors
    ],
    editSurvey
);

// DELETE /api/survey/:id - Archive survey (RESTful)
router.delete("/:id",
    protect,
    [
        param('id').isMongoId().withMessage('Invalid survey ID'),
        handleValidationErrors
    ],
    archiveSurvey
);

// POST /api/survey/:id/submit - Submit survey response (RESTful with public access)
router.post("/:id/submit",
    optionalAuth,  // Make auth optional for public forms
    submitFormLimit,
    [
        param('id').isString().withMessage('Invalid survey identifier'),
        ...validateSubmission,
        handleValidationErrors
    ],
    surveySubmission
);

// GET /api/survey/:id/submissions - Get survey submissions (RESTful)
router.get("/:id/submissions",
    protect,
    [
        param('id').isMongoId().withMessage('Invalid survey ID'),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        handleValidationErrors
    ],
    getSurveySubmission
);

module.exports = router;
