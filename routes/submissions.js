import express from 'express';
import { param, query, validationResult } from 'express-validator';
import { Submission, Form } from '../models/index.js';

const router = express.Router();

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

// GET /api/submissions/:formId - Get all submissions for a form
router.get('/:formId', [
  param('formId').isMongoId().withMessage('Invalid form ID'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('includeSpam').optional().isBoolean().withMessage('includeSpam must be a boolean'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { formId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const includeSpam = req.query.includeSpam === 'true';

    // Check if form exists
    const form = await Form.findById(formId);
    if (!form) {
      return res.status(404).json({
        success: false,
        error: 'Form not found'
      });
    }

    // Build filter
    const filter = { formId };
    if (!includeSpam) {
      filter.isSpam = { $ne: true };
    }

    const submissions = await Submission.find(filter)
      .populate('attachments.fileId', 'originalName fileName mimeType size')
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
          totalSubmissions: { $sum: 1 },
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
          totalSubmissions: 0,
          validSubmissions: 0,
          spamSubmissions: 0,
          avgCompletionTime: 0
        }
      }
    });
  } catch (error) {
    console.error('Error fetching submissions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch submissions'
    });
  }
});

// GET /api/submissions/single/:id - Get a specific submission
router.get('/single/:id', [
  param('id').isMongoId().withMessage('Invalid submission ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id)
      .populate('formId', 'title fields')
      .populate('attachments.fileId', 'originalName fileName mimeType size')
      .select('-__v');

    if (!submission) {
      return res.status(404).json({
        success: false,
        error: 'Submission not found'
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
});

// DELETE /api/submissions/single/:id - Delete a specific submission
router.delete('/single/:id', [
  param('id').isMongoId().withMessage('Invalid submission ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const submission = await Submission.findByIdAndDelete(req.params.id);

    if (!submission) {
      return res.status(404).json({
        success: false,
        error: 'Submission not found'
      });
    }

    // Update form analytics
    await Form.findByIdAndUpdate(
      submission.formId,
      { $inc: { 'analytics.totalSubmissions': -1 } }
    );

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
});

// POST /api/submissions/single/:id/mark-spam - Mark submission as spam
router.post('/single/:id/mark-spam', [
  param('id').isMongoId().withMessage('Invalid submission ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const submission = await Submission.findByIdAndUpdate(
      req.params.id,
      {
        isSpam: true,
        spamScore: 100
      },
      { new: true }
    );

    if (!submission) {
      return res.status(404).json({
        success: false,
        error: 'Submission not found'
      });
    }

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
});

// POST /api/submissions/single/:id/unmark-spam - Unmark submission as spam
router.post('/single/:id/unmark-spam', [
  param('id').isMongoId().withMessage('Invalid submission ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const submission = await Submission.findByIdAndUpdate(
      req.params.id,
      {
        isSpam: false,
        spamScore: 0
      },
      { new: true }
    );

    if (!submission) {
      return res.status(404).json({
        success: false,
        error: 'Submission not found'
      });
    }

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
});

// GET /api/submissions/:formId/export - Export submissions as CSV
router.get('/:formId/export', [
  param('formId').isMongoId().withMessage('Invalid form ID'),
  query('format').optional().isIn(['csv', 'json']).withMessage('Format must be csv or json'),
  query('includeSpam').optional().isBoolean().withMessage('includeSpam must be a boolean'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { formId } = req.params;
    const format = req.query.format || 'csv';
    const includeSpam = req.query.includeSpam === 'true';

    // Check if form exists
    const form = await Form.findById(formId);
    if (!form) {
      return res.status(404).json({
        success: false,
        error: 'Form not found'
      });
    }

    // Build filter
    const filter = { formId };
    if (!includeSpam) {
      filter.isSpam = { $ne: true };
    }

    const submissions = await Submission.find(filter)
      .sort({ submittedAt: -1 })
      .select('-__v -ipAddress -userAgent');

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${form.title}-submissions.json"`);
      return res.json({
        form: {
          title: form.title,
          exportedAt: new Date().toISOString()
        },
        submissions
      });
    }

    // CSV Export
    if (submissions.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No submissions found to export'
      });
    }

    // Get all unique field keys from submissions
    const allFields = new Set();
    submissions.forEach(submission => {
      Object.keys(submission.data).forEach(key => allFields.add(key));
    });

    // Create CSV header
    const headers = ['Submission ID', 'Submitted At', ...Array.from(allFields)];
    let csvContent = headers.join(',') + '\n';

    // Add data rows
    submissions.forEach(submission => {
      const row = [
        submission._id,
        submission.submittedAt.toISOString()
      ];

      // Add field values
      Array.from(allFields).forEach(field => {
        const value = submission.data.get ? submission.data.get(field) : submission.data[field];
        const csvValue = value ? String(value).replace(/"/g, '""') : '';
        row.push(`"${csvValue}"`);
      });

      csvContent += row.join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${form.title}-submissions.csv"`);
    res.send(csvContent);

  } catch (error) {
    console.error('Error exporting submissions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export submissions'
    });
  }
});

export default router;