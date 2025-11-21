import express from 'express';
import { body, validationResult } from 'express-validator';
import emailService from '../services/emailService.js';

const router = express.Router();

// Validation middleware
const validateEmail = [
  body('to').isEmail().withMessage('Valid email address is required'),
  body('subject').notEmpty().trim().withMessage('Subject is required'),
];

const validateFormNotification = [
  ...validateEmail,
  body('message').notEmpty().trim().withMessage('Message is required'),
  body('from').optional().isEmail().withMessage('From must be a valid email address'),
  body('analyticsUrl').optional().isURL().withMessage('Analytics URL must be valid'),
  body('customLinks').optional().isArray().withMessage('Custom links must be an array'),
  body('customLinks.*.label').optional().notEmpty().withMessage('Link label is required'),
  body('customLinks.*.url').optional().isURL().withMessage('Link URL must be valid'),
];

const validateWelcomeEmail = [
  body('to').isEmail().withMessage('Valid email address is required'),
  body('name').optional().trim().isLength({ min: 1 }).withMessage('Name must not be empty'),
];

// Send form notification email
router.post('/send-notification', validateFormNotification, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const result = await emailService.sendFormNotification(req.body);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Email notification error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Send welcome email
router.post('/welcome', validateWelcomeEmail, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { to, name } = req.body;
    const result = await emailService.sendWelcomeEmail({ to, name });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Welcome email error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Send form submission notification
router.post('/form-submission', [
  body('to').isEmail().withMessage('Valid email address is required'),
  body('formTitle').notEmpty().trim().withMessage('Form title is required'),
  body('submissionData').isObject().withMessage('Submission data is required'),
  body('formAnalyticsUrl').optional().isURL().withMessage('Analytics URL must be valid'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const result = await emailService.sendFormSubmissionNotification(req.body);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Form submission email error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Send feedback notification to admin
router.post('/feedback-notification', [
  body('feedback').isObject().withMessage('Feedback object is required'),
  body('feedback._id').notEmpty().withMessage('Feedback ID is required'),
  body('feedback.type').notEmpty().withMessage('Feedback type is required'),
  body('feedback.title').notEmpty().withMessage('Feedback title is required'),
  body('feedback.description').notEmpty().withMessage('Feedback description is required'),
  body('adminEmail').optional().isEmail().withMessage('Admin email must be valid'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { feedback, adminEmail } = req.body;
    const result = await emailService.sendFeedbackNotificationToAdmin({ feedback, adminEmail });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Feedback notification email error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


export default router;