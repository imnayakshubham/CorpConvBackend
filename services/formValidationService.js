/**
 * Form Validation Service
 *
 * Validates form schemas and submissions to ensure data integrity
 */

const fieldTransformService = require('./fieldTransformService');

class FormValidationService {
    /**
     * Validate a complete form schema
     * @param {Object} schema - Form schema to validate
     * @returns {Object} - Validation result {valid: boolean, errors: Array}
     */
    validateFormSchema(schema) {
        const errors = [];

        // Check required fields
        if (!schema.survey_title && !schema.title) {
            errors.push({ field: 'title', message: 'Form title is required' });
        }

        // Validate title length
        const title = schema.survey_title || schema.title || '';
        if (title.length < 3) {
            errors.push({ field: 'title', message: 'Title must be at least 3 characters' });
        }
        if (title.length > 100) {
            errors.push({ field: 'title', message: 'Title must be less than 100 characters' });
        }

        // Validate fields array
        const fields = schema.survey_form || schema.fields || [];
        if (!Array.isArray(fields)) {
            errors.push({ field: 'fields', message: 'Fields must be an array' });
        } else {
            fields.forEach((field, index) => {
                const fieldErrors = this.validateField(field, index);
                errors.push(...fieldErrors);
            });
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Validate a single field definition
     * @param {Object} field - Field definition
     * @param {number} index - Field index in array
     * @returns {Array} - Array of errors
     */
    validateField(field, index) {
        const errors = [];
        const prefix = `field[${index}]`;

        // Check required properties
        if (!field.label) {
            errors.push({ field: `${prefix}.label`, message: 'Field label is required' });
        }

        const fieldType = field.type || field.input_type;
        if (!fieldType) {
            errors.push({ field: `${prefix}.type`, message: 'Field type is required' });
        }

        // Validate field type
        const validTypes = [
            'text', 'email', 'number', 'textarea', 'url', 'phone', 'date', 'time',
            'select', 'checkbox', 'radio', 'file',
            'rating', 'slider', 'tags', 'scheduler', 'address', 'social',
            'signature', 'statement', 'banner', 'poll'
        ];

        if (fieldType && !validTypes.includes(fieldType)) {
            errors.push({ field: `${prefix}.type`, message: `Invalid field type: ${fieldType}` });
        }

        // Validate options for select/radio/checkbox fields
        if (['select', 'radio', 'checkbox'].includes(fieldType)) {
            const options = field.options || field.user_select_options;
            if (!options || options.length === 0) {
                errors.push({ field: `${prefix}.options`, message: 'Options required for this field type' });
            }
        }

        return errors;
    }

    /**
     * Validate a form submission
     * @param {Object} survey - Survey document
     * @param {Object} submissionData - Submission data to validate
     * @returns {Object} - Validation result {valid: boolean, errors: Object}
     */
    validateSubmission(survey, submissionData) {
        const errors = {};
        const { survey_form = [] } = survey;

        survey_form.forEach(field => {
            const fieldId = field._id || field.id;
            const fieldType = field.type || field.input_type;
            const value = submissionData[fieldId];
            const isRequired = field.is_required || field.validation?.required || field.required;

            // Check required fields
            if (isRequired && (value === undefined || value === null || value === '')) {
                errors[fieldId] = 'This field is required';
                return;
            }

            // Skip validation if field is empty and not required
            if (!value && !isRequired) {
                return;
            }

            // Type-specific validation
            const typeValidation = fieldTransformService.validate(fieldType, value, field);
            if (!typeValidation.valid) {
                errors[fieldId] = typeValidation.error;
            }

            // Length validation for text fields
            if (['text', 'textarea'].includes(fieldType)) {
                const validation = field.validation || {};
                const strValue = String(value);

                if (validation.min_length && strValue.length < validation.min_length) {
                    errors[fieldId] = `Must be at least ${validation.min_length} characters`;
                }

                if (validation.max_length && strValue.length > validation.max_length) {
                    errors[fieldId] = `Must be at most ${validation.max_length} characters`;
                }
            }
        });

        return {
            valid: Object.keys(errors).length === 0,
            errors
        };
    }

    /**
     * Sanitize form input to prevent XSS attacks
     * @param {string} input - User input to sanitize
     * @returns {string} - Sanitized input
     */
    sanitizeInput(input) {
        if (typeof input !== 'string') {
            return input;
        }

        // Remove script tags and event handlers
        return input
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
            .replace(/javascript:/gi, '')
            .trim();
    }

    /**
     * Sanitize all fields in submission data
     * @param {Object} data - Submission data
     * @returns {Object} - Sanitized data
     */
    sanitizeSubmissionData(data) {
        const sanitized = {};

        Object.keys(data).forEach(key => {
            const value = data[key];

            if (typeof value === 'string') {
                sanitized[key] = this.sanitizeInput(value);
            } else if (Array.isArray(value)) {
                sanitized[key] = value.map(item =>
                    typeof item === 'string' ? this.sanitizeInput(item) : item
                );
            } else if (typeof value === 'object' && value !== null) {
                sanitized[key] = this.sanitizeSubmissionData(value);
            } else {
                sanitized[key] = value;
            }
        });

        return sanitized;
    }
}

module.exports = new FormValidationService();
