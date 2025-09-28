import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { Form, Submission, AnalyticsEvent } from '../models/index.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';

const router = express.Router();

// Rate limiting for form operations
const createFormLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 form creations per windowMs
  message: { error: 'Too many forms created, please try again later.' }
});

const submitFormLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5, // Limit each IP to 5 submissions per minute
  message: { error: 'Too many submissions, please try again later.' }
});

// Validation middleware
const validateForm = [
  body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Title is required and must be less than 200 characters'),
  body('description').optional().trim().isLength({ max: 1000 }).withMessage('Description must be less than 1000 characters'),
  body('fields').isArray().withMessage('Fields must be an array'),
  body('fields.*.type').isIn(['text', 'email', 'number', 'select', 'checkbox', 'radio', 'textarea', 'file', 'date', 'phone', 'url'])
    .withMessage('Invalid field type'),
  body('fields.*.label').trim().isLength({ min: 1 }).withMessage('Field label is required'),
  body('status').optional().isIn(['draft', 'published', 'archived']).withMessage('Invalid status')
];

const validateSubmission = [
  body('data').isObject().withMessage('Submission data must be an object'),
  body('sessionId').optional().isString().withMessage('Session ID must be a string')
];

// Helper function to handle validation errors
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

// GET /api/forms - List user's forms (with pagination)
router.get('/', authenticateToken, [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('status').optional().isIn(['draft', 'published', 'archived']).withMessage('Invalid status filter'),
  handleValidationErrors
], async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = { userId: req.user._id };
    if (req.query.status) {
      filter.status = req.query.status;
    }

    const forms = await Form.find(filter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-__v');

    const total = await Form.countDocuments(filter);
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        forms,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    console.error('Error fetching forms:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch forms'
    });
  }
});

// GET /api/forms/:id - Get a specific form (user's own form)
router.get('/:id', authenticateToken, [
  param('id').isMongoId().withMessage('Invalid form ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const form = await Form.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).select('-__v');

    if (!form) {
      return res.status(404).json({
        success: false,
        error: 'Form not found'
      });
    }

    res.json({
      success: true,
      data: form
    });
  } catch (error) {
    console.error('Error fetching form:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch form'
    });
  }
});

// GET /api/forms/slug/:slug - Get form by slug (for public access)
router.get('/slug/:slug', [
  param('slug').isString().isLength({ min: 1 }).withMessage('Invalid slug'),
  handleValidationErrors
], async (req, res) => {
  try {
    const form = await Form.findOne({
      slug: req.params.slug,
      status: 'published'
    }).select('-__v');

    if (!form) {
      return res.status(404).json({
        success: false,
        error: 'Form not found'
      });
    }

    // Track form view
    const sessionId = req.headers['x-session-id'] || 'anonymous';

    try {
      await AnalyticsEvent.create({
        formId: form._id,
        eventType: 'view',
        sessionId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        referrer: req.get('Referer')
      });
    } catch (analyticsError) {
      console.error('Error tracking form view:', analyticsError);
    }

    res.json({
      success: true,
      data: form
    });
  } catch (error) {
    console.error('Error fetching form by slug:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch form'
    });
  }
});

// POST /api/forms - Create a new form
router.post('/', authenticateToken, createFormLimit, validateForm, handleValidationErrors, async (req, res) => {
  try {
    const formData = {
      title: req.body.title,
      description: req.body.description,
      fields: req.body.fields || [],
      logic: req.body.logic || [],
      settings: req.body.settings || {},
      theme: req.body.theme || {},
      status: req.body.status || 'draft',
      userId: req.user._id
    };

    const form = new Form(formData);
    await form.save();

    res.status(201).json({
      success: true,
      data: form,
      message: 'Form created successfully'
    });
  } catch (error) {
    console.error('Error creating form:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create form'
    });
  }
});

// PUT /api/forms/:id - Update a form
router.put('/:id', authenticateToken, [
  param('id').isMongoId().withMessage('Invalid form ID'),
  ...validateForm,
  handleValidationErrors
], async (req, res) => {
  try {
    const updateData = {
      title: req.body.title,
      description: req.body.description,
      fields: req.body.fields,
      logic: req.body.logic,
      settings: req.body.settings,
      theme: req.body.theme,
      status: req.body.status
    };

    const form = await Form.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      updateData,
      { new: true, runValidators: true }
    );

    if (!form) {
      return res.status(404).json({
        success: false,
        error: 'Form not found'
      });
    }

    res.json({
      success: true,
      data: form,
      message: 'Form updated successfully'
    });
  } catch (error) {
    console.error('Error updating form:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update form'
    });
  }
});

// DELETE /api/forms/:id - Delete a form
router.delete('/:id', authenticateToken, [
  param('id').isMongoId().withMessage('Invalid form ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const form = await Form.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!form) {
      return res.status(404).json({
        success: false,
        error: 'Form not found'
      });
    }

    // Delete associated submissions
    await Submission.deleteMany({ formId: req.params.id });

    // Delete associated analytics events
    await AnalyticsEvent.deleteMany({ formId: req.params.id });

    res.json({
      success: true,
      message: 'Form deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting form:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete form'
    });
  }
});

// POST /api/forms/:id/duplicate - Duplicate a form
router.post('/:id/duplicate', authenticateToken, [
  param('id').isMongoId().withMessage('Invalid form ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const originalForm = await Form.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!originalForm) {
      return res.status(404).json({
        success: false,
        error: 'Form not found'
      });
    }

    const duplicatedForm = new Form({
      title: `${originalForm.title} (Copy)`,
      description: originalForm.description,
      fields: originalForm.fields,
      logic: originalForm.logic,
      settings: originalForm.settings,
      theme: originalForm.theme,
      status: 'draft',
      userId: req.user._id
    });

    await duplicatedForm.save();

    res.status(201).json({
      success: true,
      data: duplicatedForm,
      message: 'Form duplicated successfully'
    });
  } catch (error) {
    console.error('Error duplicating form:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to duplicate form'
    });
  }
});

// POST /api/forms/:id/submit - Submit a form response
router.post('/:id/submit', submitFormLimit, [
  param('id').isMongoId().withMessage('Invalid form ID'),
  ...validateSubmission,
  handleValidationErrors
], async (req, res) => {
  try {
    const form = await Form.findById(req.params.id);

    if (!form) {
      return res.status(404).json({
        success: false,
        error: 'Form not found'
      });
    }

    if (form.status !== 'published') {
      return res.status(400).json({
        success: false,
        error: 'Form is not published'
      });
    }

    // Create submission
    const submission = new Submission({
      formId: req.params.id,
      data: req.body.data,
      sessionId: req.body.sessionId || req.headers['x-session-id'] || 'anonymous',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      source: 'web'
    });

    await submission.save();

    // Track submission event
    try {
      await AnalyticsEvent.create({
        formId: form._id,
        eventType: 'submit_success',
        sessionId: submission.sessionId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
    } catch (analyticsError) {
      console.error('Error tracking submission:', analyticsError);
    }

    res.status(201).json({
      success: true,
      data: {
        submissionId: submission._id,
        message: form.settings.successMessage || 'Thank you for your submission!'
      }
    });
  } catch (error) {
    console.error('Error submitting form:', error);

    // Track submission error
    try {
      await AnalyticsEvent.create({
        formId: req.params.id,
        eventType: 'submit_error',
        sessionId: req.body.sessionId || req.headers['x-session-id'] || 'anonymous',
        data: { error: error.message },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
    } catch (analyticsError) {
      console.error('Error tracking submission error:', analyticsError);
    }

    res.status(500).json({
      success: false,
      error: 'Failed to submit form'
    });
  }
});

// PUT /api/forms/:id/publish - Toggle form publish status
router.put('/:id/publish', authenticateToken, [
  param('id').isMongoId().withMessage('Invalid form ID'),
  body('isPublished').isBoolean().withMessage('isPublished must be a boolean'),
  handleValidationErrors
], async (req, res) => {
  try {
    const form = await Form.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { status: req.body.isPublished ? 'published' : 'draft' },
      { new: true, runValidators: true }
    );

    if (!form) {
      return res.status(404).json({
        success: false,
        error: 'Form not found'
      });
    }

    res.json({
      success: true,
      data: form,
      message: `Form ${req.body.isPublished ? 'published' : 'unpublished'} successfully`
    });
  } catch (error) {
    console.error('Error toggling form publish status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update form status'
    });
  }
});

// GET /api/forms/:id/verify-ownership - Verify form ownership
router.get('/:id/verify-ownership', authenticateToken, [
  param('id').isMongoId().withMessage('Invalid form ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const form = await Form.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).select('_id');

    res.json({
      success: true,
      data: {
        isOwner: !!form
      }
    });
  } catch (error) {
    console.error('Error verifying form ownership:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify ownership'
    });
  }
});

export default router;