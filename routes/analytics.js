import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { cohere } from '@ai-sdk/cohere';
import { groq } from '@ai-sdk/groq';
import { generateText, streamText } from 'ai';
import { v4 as uuidv4 } from 'uuid';
import { AnalyticsEvent, Form, Submission } from '../models/index.js';
import { authenticateToken } from '../middleware/auth.js';

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

// Helper function to get AI model based on environment
function getAIModel() {
  const aiProvider = process.env.AI_PROVIDER || 'groq';
  const modelName = process.env.GROQ_MODEL || 'llama-3.1-70b-versatile';

  if (aiProvider === 'cohere' && process.env.COHERE_API_KEY) {
    return cohere('command-r-plus');
  } else if (process.env.GROQ_API_KEY) {
    return groq(modelName);
  } else {
    throw new Error('No AI provider configured. Please set GROQ_API_KEY or COHERE_API_KEY');
  }
}

// Helper function to get comprehensive form analytics data for AI
async function getFormAnalyticsForAI(formId, user_id) {
  try {
    // Get form details
    const form = await Form.findOne({ _id: formId, user_id });
    if (!form) {
      throw new Error('Form not found');
    }

    // Get submissions for the form
    const submissions = await Submission.find({ formId }).sort({ submittedAt: -1 });

    // Calculate basic metrics
    const total_submissions = submissions.length;
    const submissionsToday = submissions.filter(s => {
      const today = new Date();
      const submissionDate = new Date(s.submittedAt);
      return submissionDate.toDateString() === today.toDateString();
    }).length;

    const submissionsThisWeek = submissions.filter(s => {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return new Date(s.submittedAt) >= weekAgo;
    }).length;

    // Get submission data by day for the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentSubmissions = submissions.filter(s => new Date(s.submittedAt) >= thirtyDaysAgo);

    const submissionsByDay = {};
    recentSubmissions.forEach(submission => {
      const date = new Date(submission.submittedAt).toISOString().split('T')[0];
      submissionsByDay[date] = (submissionsByDay[date] || 0) + 1;
    });

    // Prepare field analysis
    const fieldData = {};
    form.schema.fields.forEach(field => {
      fieldData[field._id] = {
        name: field.label || field._id,
        type: field.type,
        values: [],
        completionRate: 0
      };
    });

    // Analyze field responses
    submissions.forEach(submission => {
      Object.entries(submission.data).forEach(([field_id, value]) => {
        if (fieldData[field_id] && value !== null && value !== undefined && value !== '') {
          fieldData[field_id].values.push(value);
        }
      });
    });

    // Calculate completion rates
    Object.keys(fieldData).forEach(field_id => {
      const responses = fieldData[field_id].values.length;
      fieldData[field_id].completionRate = total_submissions > 0 ? (responses / total_submissions) * 100 : 0;
    });

    return {
      form: {
        id: form._id,
        title: form.title,
        description: form.description,
        createdAt: form.createdAt,
        updatedAt: form.updatedAt
      },
      metrics: {
        total_submissions,
        submissionsToday,
        submissionsThisWeek,
        avgCompletionRate: Object.values(fieldData).reduce((acc, field) => acc + field.completionRate, 0) / Object.keys(fieldData).length
      },
      chartData: {
        submissionsByDay: Object.entries(submissionsByDay).map(([date, count]) => ({ date, count })),
        fieldCompletionRates: Object.entries(fieldData).map(([id, data]) => ({
          field: data.name,
          completionRate: data.completionRate
        }))
      },
      fieldData,
      recentSubmissions: recentSubmissions.slice(0, 10).map(s => ({
        id: s._id,
        submittedAt: s.submittedAt,
        data: s.data
      }))
    };
  } catch (error) {
    console.error('Error getting form analytics for AI:', error);
    throw error;
  }
}

// Store for conversation history (in production, use Redis or database)
const conversationStore = new Map();

// POST /api/analytics/event - Track an analytics event
router.post('/event', [
  body('formId').isMongoId().withMessage('Invalid form ID'),
  body('eventType').isIn([
    'view', 'field_focus', 'field_blur', 'field_change', 'submit',
    'submit_success', 'submit_error', 'validation_error', 'file_upload', 'page_exit'
  ]).withMessage('Invalid event type'),
  body('sessionId').isString().withMessage('Session ID is required'),
  body('field_id').optional().isString().withMessage('Field ID must be a string'),
  body('data').optional().isObject().withMessage('Data must be an object'),
  handleValidationErrors
], async (req, res) => {
  try {
    const eventData = {
      formId: req.body.formId,
      eventType: req.body.eventType,
      sessionId: req.body.sessionId,
      field_id: req.body.field_id,
      fieldType: req.body.fieldType,
      data: req.body.data,
      timeOnField: req.body.timeOnField,
      scrollDepth: req.body.scrollDepth,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      referrer: req.get('Referer'),
      deviceInfo: req.body.deviceInfo || {}
    };

    const event = new AnalyticsEvent(eventData);
    await event.save();

    res.status(201).json({
      success: true,
      data: { eventId: event._id },
      message: 'Event tracked successfully'
    });

  } catch (error) {
    console.error('Error tracking analytics event:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to track event'
    });
  }
});

// GET /api/analytics/:formId - Get form analytics
router.get('/:formId', [
  param('formId').isMongoId().withMessage('Invalid form ID'),
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date'),
  query('granularity').optional().isIn(['hour', 'day', 'week', 'month']).withMessage('Invalid granularity'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { formId } = req.params;
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    const granularity = req.query.granularity || 'day';

    // Check if form exists
    const form = await Form.findById(formId);
    if (!form) {
      return res.status(404).json({
        success: false,
        error: 'Form not found'
      });
    }

    // Get overall analytics using static method
    const overallAnalytics = await AnalyticsEvent.getFormAnalytics(formId, startDate, endDate);

    // Get time-based analytics
    let timeGroup;
    switch (granularity) {
      case 'hour':
        timeGroup = {
          year: { $year: '$timestamp' },
          month: { $month: '$timestamp' },
          day: { $dayOfMonth: '$timestamp' },
          hour: { $hour: '$timestamp' }
        };
        break;
      case 'week':
        timeGroup = {
          year: { $year: '$timestamp' },
          week: { $week: '$timestamp' }
        };
        break;
      case 'month':
        timeGroup = {
          year: { $year: '$timestamp' },
          month: { $month: '$timestamp' }
        };
        break;
      default: // day
        timeGroup = {
          year: { $year: '$timestamp' },
          month: { $month: '$timestamp' },
          day: { $dayOfMonth: '$timestamp' }
        };
    }

    const timeBasedAnalytics = await AnalyticsEvent.aggregate([
      {
        $match: {
          formId: form._id,
          timestamp: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            time: timeGroup,
            eventType: '$eventType'
          },
          count: { $sum: 1 },
          uniqueSessions: { $addToSet: '$sessionId' }
        }
      },
      {
        $group: {
          _id: '$_id.time',
          events: {
            $push: {
              eventType: '$_id.eventType',
              count: '$count',
              uniqueUsers: { $size: '$uniqueSessions' }
            }
          },
          totalEvents: { $sum: '$count' },
          totalUsers: { $addToSet: '$uniqueSessions' }
        }
      },
      {
        $project: {
          _id: 1,
          events: 1,
          totalEvents: 1,
          totalUsers: {
            $size: {
              $reduce: {
                input: '$totalUsers',
                initialValue: [],
                in: { $setUnion: ['$$value', '$$this'] }
              }
            }
          }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    // Get field-specific analytics
    const fieldAnalytics = await AnalyticsEvent.aggregate([
      {
        $match: {
          formId: form._id,
          timestamp: { $gte: startDate, $lte: endDate },
          field_id: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: {
            field_id: '$field_id',
            eventType: '$eventType'
          },
          count: { $sum: 1 },
          avgTimeOnField: { $avg: '$timeOnField' }
        }
      },
      {
        $group: {
          _id: '$_id.field_id',
          events: {
            $push: {
              eventType: '$_id.eventType',
              count: '$count',
              avgTimeOnField: '$avgTimeOnField'
            }
          }
        }
      }
    ]);

    // Get conversion funnel data
    const funnelData = await AnalyticsEvent.aggregate([
      {
        $match: {
          formId: form._id,
          timestamp: { $gte: startDate, $lte: endDate },
          eventType: { $in: ['view', 'field_focus', 'submit_success'] }
        }
      },
      {
        $group: {
          _id: '$sessionId',
          events: { $push: '$eventType' }
        }
      },
      {
        $project: {
          hasView: { $in: ['view', '$events'] },
          hasInteraction: { $in: ['field_focus', '$events'] },
          hasSubmission: { $in: ['submit_success', '$events'] }
        }
      },
      {
        $group: {
          _id: null,
          total_views: { $sum: { $cond: ['$hasView', 1, 0] } },
          totalInteractions: { $sum: { $cond: ['$hasInteraction', 1, 0] } },
          total_submissions: { $sum: { $cond: ['$hasSubmission', 1, 0] } }
        }
      }
    ]);

    const funnel = funnelData[0] || { total_views: 0, totalInteractions: 0, total_submissions: 0 };

    res.json({
      success: true,
      data: {
        overview: {
          formTitle: form.title,
          dateRange: { startDate, endDate },
          totalEvents: overallAnalytics.reduce((sum, item) => sum + item.count, 0),
          uniqueUsers: overallAnalytics.reduce((sum, item) => sum + item.uniqueUsers, 0)
        },
        overallAnalytics,
        timeBasedAnalytics,
        fieldAnalytics,
        conversionFunnel: {
          views: funnel.total_views,
          interactions: funnel.totalInteractions,
          submissions: funnel.total_submissions,
          viewToInteractionRate: funnel.total_views > 0 ? (funnel.totalInteractions / funnel.total_views * 100).toFixed(2) : 0,
          interactionToSubmissionRate: funnel.totalInteractions > 0 ? (funnel.total_submissions / funnel.totalInteractions * 100).toFixed(2) : 0,
          overallConversionRate: funnel.total_views > 0 ? (funnel.total_submissions / funnel.total_views * 100).toFixed(2) : 0
        }
      }
    });

  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics'
    });
  }
});

// GET /api/analytics/:formId/realtime - Get real-time analytics
router.get('/:formId/realtime', [
  param('formId').isMongoId().withMessage('Invalid form ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { formId } = req.params;
    const lastHour = new Date(Date.now() - 60 * 60 * 1000);

    // Get events from the last hour
    const realtimeEvents = await AnalyticsEvent.aggregate([
      {
        $match: {
          formId: new mongoose.Types.ObjectId(formId),
          timestamp: { $gte: lastHour }
        }
      },
      {
        $group: {
          _id: '$eventType',
          count: { $sum: 1 },
          lastOccurrence: { $max: '$timestamp' },
          uniqueSessions: { $addToSet: '$sessionId' }
        }
      },
      {
        $project: {
          eventType: '$_id',
          count: 1,
          lastOccurrence: 1,
          uniqueUsers: { $size: '$uniqueSessions' }
        }
      }
    ]);

    // Get current active sessions (sessions with activity in last 5 minutes)
    const activeSessions = await AnalyticsEvent.aggregate([
      {
        $match: {
          formId: new mongoose.Types.ObjectId(formId),
          timestamp: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: '$sessionId',
          lastActivity: { $max: '$timestamp' },
          eventCount: { $sum: 1 }
        }
      },
      {
        $count: 'activeSessions'
      }
    ]);

    res.json({
      success: true,
      data: {
        realtimeEvents,
        activeUsers: activeSessions[0]?.activeSessions || 0,
        lastUpdated: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error fetching real-time analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch real-time analytics'
    });
  }
});

// GET /api/analytics/:formId/heatmap - Get form field interaction heatmap data
router.get('/:formId/heatmap', [
  param('formId').isMongoId().withMessage('Invalid form ID'),
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { formId } = req.params;
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();

    const heatmapData = await AnalyticsEvent.aggregate([
      {
        $match: {
          formId: new mongoose.Types.ObjectId(formId),
          timestamp: { $gte: startDate, $lte: endDate },
          eventType: { $in: ['field_focus', 'field_blur', 'field_change'] },
          field_id: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: '$field_id',
          totalInteractions: { $sum: 1 },
          focusEvents: { $sum: { $cond: [{ $eq: ['$eventType', 'field_focus'] }, 1, 0] } },
          changeEvents: { $sum: { $cond: [{ $eq: ['$eventType', 'field_change'] }, 1, 0] } },
          avgTimeOnField: { $avg: '$timeOnField' },
          uniqueUsers: { $addToSet: '$sessionId' }
        }
      },
      {
        $project: {
          field_id: '$_id',
          totalInteractions: 1,
          focusEvents: 1,
          changeEvents: 1,
          avgTimeOnField: 1,
          uniqueUsers: { $size: '$uniqueUsers' },
          completionRate: {
            $cond: [
              { $gt: ['$focusEvents', 0] },
              { $multiply: [{ $divide: ['$changeEvents', '$focusEvents'] }, 100] },
              0
            ]
          }
        }
      },
      { $sort: { totalInteractions: -1 } }
    ]);

    res.json({
      success: true,
      data: heatmapData
    });

  } catch (error) {
    console.error('Error fetching heatmap data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch heatmap data'
    });
  }
});

// Analytics chat endpoint
router.post('/chat/:formId', authenticateToken, async (req, res) => {
  try {
    const { formId } = req.params;
    const { message, conversationId } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get or create conversation ID
    const convId = conversationId || uuidv4();

    // Get conversation history
    let conversationHistory = conversationStore.get(convId) || [];

    // Get form analytics data
    const analyticsData = await getFormAnalyticsForAI(formId, req.user.user_id);

    // Prepare context for AI
    const systemPrompt = `You are an expert data analyst helping users understand their form analytics.

Form Information:
- Title: ${analyticsData.form.title}
- Total Submissions: ${analyticsData.metrics.total_submissions}
- Submissions Today: ${analyticsData.metrics.submissionsToday}
- Submissions This Week: ${analyticsData.metrics.submissionsThisWeek}
- Average Completion Rate: ${analyticsData.metrics.avgCompletionRate.toFixed(1)}%

Field Information:
${Object.entries(analyticsData.fieldData).map(([id, field]) =>
      `- ${field.name} (${field.type}): ${field.completionRate.toFixed(1)}% completion rate, ${field.values.length} responses`
    ).join('\n')}

Recent Trends:
${analyticsData.chartData.submissionsByDay.slice(-7).map(day =>
      `- ${day.date}: ${day.count} submissions`
    ).join('\n')}

Please provide insights, answer questions, and suggest improvements based on this data. Be specific and actionable in your recommendations.`;

    // Add user message to history
    conversationHistory.push({ role: 'user', content: message });

    // Get AI model
    const model = getAIModel();

    // Generate response
    const result = await generateText({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory
      ],
      temperature: 0.7,
      maxTokens: 1000,
    });

    const aiResponse = result.text;

    // Add AI response to history
    conversationHistory.push({ role: 'assistant', content: aiResponse });

    // Store conversation (limit to last 20 messages)
    if (conversationHistory.length > 20) {
      conversationHistory = conversationHistory.slice(-20);
    }
    conversationStore.set(convId, conversationHistory);

    res.json({
      response: aiResponse,
      conversationId: convId,
      analyticsData
    });

  } catch (error) {
    console.error('Analytics chat error:', error);
    res.status(500).json({ error: 'Failed to generate analytics response' });
  }
});

// Analytics chat streaming endpoint
router.post('/chat/:formId/stream', authenticateToken, async (req, res) => {
  try {
    const { formId } = req.params;
    const { message, conversationId } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get or create conversation ID
    const convId = conversationId || uuidv4();

    // Get conversation history
    let conversationHistory = conversationStore.get(convId) || [];

    // Get form analytics data
    const analyticsData = await getFormAnalyticsForAI(formId, req.user.user_id);

    // Prepare context for AI
    const systemPrompt = `You are an expert data analyst helping users understand their form analytics.

Form Information:
- Title: ${analyticsData.form.title}
- Total Submissions: ${analyticsData.metrics.total_submissions}
- Submissions Today: ${analyticsData.metrics.submissionsToday}
- Submissions This Week: ${analyticsData.metrics.submissionsThisWeek}
- Average Completion Rate: ${analyticsData.metrics.avgCompletionRate.toFixed(1)}%

Field Information:
${Object.entries(analyticsData.fieldData).map(([id, field]) =>
      `- ${field.name} (${field.type}): ${field.completionRate.toFixed(1)}% completion rate, ${field.values.length} responses`
    ).join('\n')}

Recent Trends:
${analyticsData.chartData.submissionsByDay.slice(-7).map(day =>
      `- ${day.date}: ${day.count} submissions`
    ).join('\n')}

Please provide insights, answer questions, and suggest improvements based on this data. Be specific and actionable in your recommendations.`;

    // Add user message to history
    conversationHistory.push({ role: 'user', content: message });

    // Get AI model
    const model = getAIModel();

    // Set headers for streaming
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Generate streaming response
    const result = await streamText({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory
      ],
      temperature: 0.7,
      maxTokens: 1000,
    });

    let fullResponse = '';

    for await (const delta of result.textStream) {
      fullResponse += delta;
      res.write(delta);
    }

    // Add AI response to history
    conversationHistory.push({ role: 'assistant', content: fullResponse });

    // Store conversation (limit to last 20 messages)
    if (conversationHistory.length > 20) {
      conversationHistory = conversationHistory.slice(-20);
    }
    conversationStore.set(convId, conversationHistory);

    res.end();

  } catch (error) {
    console.error('Analytics chat streaming error:', error);
    res.status(500).json({ error: 'Failed to generate analytics response' });
  }
});

// Get conversation history
router.get('/chat/:formId/history/:conversationId', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const conversationHistory = conversationStore.get(conversationId) || [];

    res.json({ history: conversationHistory });
  } catch (error) {
    console.error('Error getting conversation history:', error);
    res.status(500).json({ error: 'Failed to get conversation history' });
  }
});

export default router;