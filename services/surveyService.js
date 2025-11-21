/**
 * Survey Service
 *
 * Business logic for survey operations
 */

const { Survey } = require('../models/surveyModel');
const formValidationService = require('./formValidationService');

class SurveyService {
    /**
     * Validate survey ownership
     * @param {string} surveyId - Survey ID
     * @param {string} userId - User ID
     * @returns {Promise<boolean>} - True if user owns the survey
     */
    async checkOwnership(surveyId, userId) {
        const survey = await Survey.findOne({
            _id: surveyId,
            $or: [
                { created_by: userId },
                { user_id: userId }
            ]
        }).select('_id');

        return !!survey;
    }

    /**
     * Transform survey data to storage format
     * @param {Object} surveyData - Raw survey data from request
     * @returns {Object} - Transformed data ready for storage
     */
    transformToStorageFormat(surveyData) {
        return {
            survey_title: surveyData.survey_title || surveyData.title,
            survey_description: surveyData.survey_description || surveyData.description,
            survey_form: surveyData.survey_form || surveyData.fields || [],
            status: surveyData.status || 'draft',
            access: surveyData.access !== undefined ? surveyData.access : true,
            logic: surveyData.logic || [],
            settings: surveyData.settings || {},
            theme: surveyData.theme || {},
            tags: surveyData.tags || []
        };
    }

    /**
     * Calculate analytics for a survey
     * @param {string} surveyId - Survey ID
     * @returns {Promise<Object>} - Analytics data
     */
    async calculateAnalytics(surveyId) {
        const survey = await Survey.findById(surveyId)
            .populate('submissions')
            .select('view_count analytics submissions');

        if (!survey) {
            return null;
        }

        const totalViews = survey.view_count || survey.analytics?.total_views || 0;
        const totalSubmissions = survey.submissions?.length || 0;
        const conversionRate = totalViews > 0 ?
            ((totalSubmissions / totalViews) * 100).toFixed(2) : 0;

        return {
            total_views: totalViews,
            total_submissions: totalSubmissions,
            conversion_rate: conversionRate,
            last_submission_at: survey.analytics?.last_submission_at || null
        };
    }
}

module.exports = new SurveyService();
