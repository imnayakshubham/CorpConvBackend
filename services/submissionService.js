/**
 * Submission Service
 *
 * Business logic for survey submissions
 */

const Submission = require('../models/Submission');
const formValidationService = require('./formValidationService');
const fieldTransformService = require('./fieldTransformService');
const conditionalLogicService = require('./conditionalLogicService');

class SubmissionService {
    /**
     * Process and save a submission
     * @param {Object} survey - Survey document
     * @param {Object} submissionData - Raw submission data
     * @param {Object} metadata - Additional metadata (user, IP, etc.)
     * @returns {Promise<Object>} - Saved submission
     */
    async processSubmission(survey, submissionData, metadata = {}) {
        // Sanitize input
        const sanitizedData = formValidationService.sanitizeSubmissionData(submissionData);

        // Validate with conditional logic
        const logicValidation = conditionalLogicService.validateWithLogic(survey, sanitizedData);
        if (!logicValidation.valid) {
            throw new Error('Validation failed: ' + JSON.stringify(logicValidation.errors));
        }

        // Transform field data
        const transformedData = fieldTransformService.transformAll(
            sanitizedData,
            survey.survey_form || []
        );

        // Create submission
        const submission = new Submission({
            survey_id: survey._id,
            formId: survey._id,
            data: transformedData,
            survey_answered_by: metadata.userId,
            survey_created_by: survey.created_by || survey.user_id,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            sessionId: metadata.sessionId,
            source: metadata.source || 'web',
            isValid: true
        });

        await submission.save();
        return submission;
    }

    /**
     * Detect if a submission might be spam
     * @param {Object} submission - Submission to check
     * @returns {Object} - {isSpam: boolean, spamScore: number}
     */
    async detectSpam(submission) {
        let spamScore = 0;

        // Check for honeypot field (if implemented)
        if (submission.data && submission.data.get && submission.data.get('_honeypot')) {
            spamScore += 100;
        }

        // Check for rapid submissions from same IP
        if (submission.ipAddress) {
            const recentCount = await Submission.countDocuments({
                ipAddress: submission.ipAddress,
                createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } // Last 5 minutes
            });

            if (recentCount > 5) {
                spamScore += 50;
            }
        }

        // Check for suspicious patterns in text fields
        const dataObj = submission.data instanceof Map ?
            Object.fromEntries(submission.data) : submission.data;

        Object.values(dataObj || {}).forEach(value => {
            if (typeof value === 'string') {
                // Check for excessive links
                const linkCount = (value.match(/https?:\/\//g) || []).length;
                if (linkCount > 3) {
                    spamScore += 25;
                }

                // Check for repeated characters
                if (/(.)\1{10,}/.test(value)) {
                    spamScore += 15;
                }
            }
        });

        return {
            isSpam: spamScore >= 50,
            spamScore: Math.min(spamScore, 100)
        };
    }

    /**
     * Export submissions in various formats
     * @param {string} surveyId - Survey ID
     * @param {string} format - Export format (csv, json)
     * @param {Object} options - Export options
     * @returns {Promise<string|Object>} - Exported data
     */
    async exportSubmissions(surveyId, format = 'json', options = {}) {
        const filter = {
            $or: [{ survey_id: surveyId }, { formId: surveyId }]
        };

        if (!options.includeSpam) {
            filter.isSpam = { $ne: true };
        }

        const submissions = await Submission.find(filter)
            .sort({ submittedAt: -1 })
            .select('-__v -ipAddress -userAgent');

        if (format === 'json') {
            return submissions;
        }

        if (format === 'csv') {
            return this.convertToCSV(submissions);
        }

        throw new Error(`Unsupported format: ${format}`);
    }

    /**
     * Convert submissions to CSV format
     * @param {Array} submissions - Array of submissions
     * @returns {string} - CSV string
     */
    convertToCSV(submissions) {
        if (submissions.length === 0) {
            return '';
        }

        // Get all unique field keys
        const allFields = new Set();
        submissions.forEach(submission => {
            const data = submission.data instanceof Map ?
                Object.fromEntries(submission.data) : submission.data;
            Object.keys(data || {}).forEach(key => allFields.add(key));
        });

        // Create CSV header
        const headers = ['Submission ID', 'Submitted At', ...Array.from(allFields)];
        let csvContent = headers.join(',') + '\n';

        // Add data rows
        submissions.forEach(submission => {
            const data = submission.data instanceof Map ?
                Object.fromEntries(submission.data) : submission.data;

            const row = [
                submission._id,
                submission.submittedAt?.toISOString() || submission.createdAt?.toISOString()
            ];

            Array.from(allFields).forEach(field => {
                const value = data[field];
                const csvValue = value ? String(value).replace(/"/g, '""') : '';
                row.push(`"${csvValue}"`);
            });

            csvContent += row.join(',') + '\n';
        });

        return csvContent;
    }
}

module.exports = new SubmissionService();
