/**
 * Analytics Service
 *
 * Business logic for survey analytics and reporting
 */

const Submission = require('../models/Submission');
const { Survey } = require('../models/surveyModel');

class AnalyticsService {
    /**
     * Get comprehensive analytics for a survey
     * @param {string} surveyId - Survey ID
     * @param {Object} options - Options (startDate, endDate, etc.)
     * @returns {Promise<Object>} - Analytics data
     */
    async getAnalytics(surveyId, options = {}) {
        const { startDate, endDate } = options;

        const survey = await Survey.findById(surveyId)
            .select('survey_title view_count analytics created_at');

        if (!survey) {
            return null;
        }

        // Get submissions within date range
        const submissionFilter = {
            $or: [{ survey_id: surveyId }, { formId: surveyId }]
        };

        if (startDate || endDate) {
            submissionFilter.submittedAt = {};
            if (startDate) submissionFilter.submittedAt.$gte = new Date(startDate);
            if (endDate) submissionFilter.submittedAt.$lte = new Date(endDate);
        }

        const submissions = await Submission.find(submissionFilter)
            .sort({ submittedAt: -1 });

        // Calculate metrics
        const totalViews = survey.view_count || survey.analytics?.total_views || 0;
        const totalSubmissions = submissions.length;
        const conversionRate = totalViews > 0 ?
            ((totalSubmissions / totalViews) * 100).toFixed(2) : 0;

        // Group submissions by day
        const submissionsByDay = this.groupByDay(submissions);

        // Calculate completion times
        const avgCompletionTime = this.calculateAvgCompletionTime(submissions);

        return {
            overview: {
                totalViews,
                totalSubmissions,
                conversionRate,
                avgCompletionTime
            },
            timeline: submissionsByDay,
            recentSubmissions: submissions.slice(0, 10).map(s => ({
                id: s._id,
                submittedAt: s.submittedAt || s.createdAt,
                source: s.source
            }))
        };
    }

    /**
     * Group submissions by day
     * @param {Array} submissions - Array of submissions
     * @returns {Object} - Submissions grouped by day
     */
    groupByDay(submissions) {
        const grouped = {};

        submissions.forEach(submission => {
            const date = new Date(submission.submittedAt || submission.createdAt)
                .toISOString().split('T')[0];
            grouped[date] = (grouped[date] || 0) + 1;
        });

        return Object.entries(grouped).map(([date, count]) => ({
            date,
            count
        }));
    }

    /**
     * Calculate average completion time
     * @param {Array} submissions - Array of submissions
     * @returns {number} - Average time in seconds
     */
    calculateAvgCompletionTime(submissions) {
        const timesWithCompletion = submissions
            .filter(s => s.completionTime)
            .map(s => s.completionTime);

        if (timesWithCompletion.length === 0) {
            return 0;
        }

        const sum = timesWithCompletion.reduce((acc, time) => acc + time, 0);
        return Math.round(sum / timesWithCompletion.length);
    }

    /**
     * Get field-level analytics
     * @param {string} surveyId - Survey ID
     * @returns {Promise<Object>} - Field analytics
     */
    async getFieldAnalytics(surveyId) {
        const survey = await Survey.findById(surveyId)
            .select('survey_form');

        if (!survey) {
            return null;
        }

        const submissions = await Submission.find({
            $or: [{ survey_id: surveyId }, { formId: surveyId }]
        });

        const fieldStats = {};

        survey.survey_form.forEach(field => {
            const fieldId = field._id || field.id;
            fieldStats[fieldId] = {
                label: field.label,
                type: field.type || field.input_type,
                responses: 0,
                completionRate: 0,
                values: []
            };
        });

        // Analyze responses
        submissions.forEach(submission => {
            const data = submission.data instanceof Map ?
                Object.fromEntries(submission.data) : submission.data;

            Object.entries(data || {}).forEach(([fieldId, value]) => {
                if (fieldStats[fieldId] && value !== null && value !== undefined && value !== '') {
                    fieldStats[fieldId].responses++;
                    fieldStats[fieldId].values.push(value);
                }
            });
        });

        // Calculate completion rates
        const totalSubmissions = submissions.length;
        Object.keys(fieldStats).forEach(fieldId => {
            if (totalSubmissions > 0) {
                fieldStats[fieldId].completionRate =
                    ((fieldStats[fieldId].responses / totalSubmissions) * 100).toFixed(2);
            }
        });

        return fieldStats;
    }
}

module.exports = new AnalyticsService();
