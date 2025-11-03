const { Survey, Submission } = require('../models/surveyModel');
const analyticsService = require('../services/analyticsService');

const getDetailedAnalytics = async (req, res) => {
    try {
        const surveyId = req.params.id;
        const { startDate, endDate, granularity = 'day', includeFieldAnalytics = 'true' } = req.query;

        const survey = await Survey.findById(surveyId);
        if (!survey) {
            return res.error({ message: 'Survey not found', code: 404 });
        }

        if (survey.created_by.toString() !== req.user._id.toString()) {
            return res.error({ message: 'Unauthorized', code: 403 });
        }

        const dateFilter = {};
        if (startDate) dateFilter.$gte = new Date(startDate);
        if (endDate) dateFilter.$lte = new Date(endDate);

        const submissionQuery = { survey_id: surveyId };
        if (Object.keys(dateFilter).length > 0) {
            submissionQuery.createdAt = dateFilter;
        }

        const submissions = await Submission.find(submissionQuery).sort({ createdAt: -1 });

        const analytics = analyticsService.getAnalytics(survey, submissions);
        const fieldAnalytics = includeFieldAnalytics === 'true'
            ? analyticsService.getFieldAnalytics(survey, submissions)
            : null;

        return res.success({
            data: {
                survey: {
                    id: survey._id,
                    title: survey.survey_title,
                    status: survey.status,
                    created_at: survey.createdAt,
                    published_at: survey.status === 'published' ? survey.updatedAt : null
                },
                overview: {
                    total_views: survey.view_count || 0,
                    total_submissions: submissions.length,
                    conversion_rate: analytics.conversion_rate,
                    avg_completion_time: analytics.avg_completion_time,
                    spam_submissions: submissions.filter(s => s.isSpam).length,
                    spam_rate: submissions.length > 0
                        ? (submissions.filter(s => s.isSpam).length / submissions.length * 100).toFixed(2)
                        : 0
                },
                timeline: analytics.submissionsByDay,
                fieldAnalytics,
                recentSubmissions: submissions.slice(0, 10).map(s => ({
                    id: s._id,
                    submitted_at: s.createdAt,
                    completion_time: s.completionTime,
                    is_spam: s.isSpam || false
                }))
            }
        });
    } catch (error) {
        console.error('Detailed analytics error:', error);
        return res.error({ message: 'Failed to fetch analytics', error: error.message, code: 500 });
    }
};

const getOverviewAnalytics = async (req, res) => {
    try {
        const userId = req.user._id;
        const { startDate, endDate, status, sortBy = 'created_at', sortOrder = 'desc', limit = 50 } = req.query;

        const surveyFilter = { created_by: userId };
        if (status) surveyFilter.status = status;

        const surveys = await Survey.find(surveyFilter)
            .sort({ [sortBy === 'views' ? 'view_count' : sortBy]: sortOrder === 'asc' ? 1 : -1 })
            .limit(parseInt(limit));

        const submissionFilter = { survey_created_by: userId };
        if (startDate || endDate) {
            submissionFilter.createdAt = {};
            if (startDate) submissionFilter.createdAt.$gte = new Date(startDate);
            if (endDate) submissionFilter.createdAt.$lte = new Date(endDate);
        }

        const allSubmissions = await Submission.find(submissionFilter);

        const totalViews = surveys.reduce((sum, s) => sum + (s.view_count || 0), 0);
        const totalSubmissions = allSubmissions.length;
        const overallConversionRate = totalViews > 0
            ? ((totalSubmissions / totalViews) * 100).toFixed(2)
            : 0;

        const surveyAnalytics = surveys.map(survey => {
            const surveySubmissions = allSubmissions.filter(
                s => s.survey_id.toString() === survey._id.toString()
            );
            const conversionRate = survey.view_count > 0
                ? ((surveySubmissions.length / survey.view_count) * 100).toFixed(2)
                : 0;

            return {
                id: survey._id,
                title: survey.survey_title,
                status: survey.status,
                created_at: survey.createdAt,
                analytics: {
                    total_views: survey.view_count || 0,
                    total_submissions: surveySubmissions.length,
                    conversion_rate: parseFloat(conversionRate),
                    last_submission_at: surveySubmissions[0]?.createdAt || null
                }
            };
        });

        const topPerformers = {
            by_views: surveyAnalytics.sort((a, b) => b.analytics.total_views - a.analytics.total_views).slice(0, 3).map(s => s.id),
            by_submissions: surveyAnalytics.sort((a, b) => b.analytics.total_submissions - a.analytics.total_submissions).slice(0, 3).map(s => s.id),
            by_conversion: surveyAnalytics.sort((a, b) => b.analytics.conversion_rate - a.analytics.conversion_rate).slice(0, 3).map(s => s.id)
        };

        return res.success({
            data: {
                summary: {
                    total_surveys: surveys.length,
                    published_surveys: surveys.filter(s => s.status === 'published').length,
                    draft_surveys: surveys.filter(s => s.status === 'draft').length,
                    total_views: totalViews,
                    total_submissions: totalSubmissions,
                    overall_conversion_rate: parseFloat(overallConversionRate)
                },
                surveys: surveyAnalytics,
                topPerformers
            }
        });
    } catch (error) {
        console.error('Overview analytics error:', error);
        return res.error({ message: 'Failed to fetch overview analytics', error: error.message, code: 500 });
    }
};

module.exports = {
    getDetailedAnalytics,
    getOverviewAnalytics
};
