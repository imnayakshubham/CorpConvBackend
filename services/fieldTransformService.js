/**
 * Field Transform Service
 *
 * Transforms field data based on field type before storage.
 * Handles all 25 field types with proper validation and formatting.
 */

class FieldTransformService {
    /**
     * Transform field value based on its type
     * @param {string} fieldType - The type of the field
     * @param {*} value - The value to transform
     * @param {Object} field - The field configuration
     * @returns {*} - Transformed value
     */
    transformByType(fieldType, value, field = {}) {
        if (value === null || value === undefined) {
            return null;
        }

        const transformers = {
            'text': this.transformTextField.bind(this),
            'email': this.transformEmailField.bind(this),
            'number': this.transformNumberField.bind(this),
            'textarea': this.transformTextareaField.bind(this),
            'url': this.transformUrlField.bind(this),
            'link': this.transformUrlField.bind(this), // Alias for url
            'phone': this.transformPhoneField.bind(this),
            'date': this.transformDateField.bind(this),
            'time': this.transformTimeField.bind(this),
            'select': this.transformSelectField.bind(this),
            'checkbox': this.transformCheckboxField.bind(this),
            'radio': this.transformRadioField.bind(this),
            'file': this.transformFileField.bind(this),
            'rating': this.transformRatingField.bind(this),
            'slider': this.transformSliderField.bind(this),
            'tags': this.transformTagsField.bind(this),
            'scheduler': this.transformSchedulerField.bind(this),
            'address': this.transformAddressField.bind(this),
            'social': this.transformSocialField.bind(this),
            'signature': this.transformSignatureField.bind(this),
            'statement': this.transformStatementField.bind(this),
            'banner': this.transformBannerField.bind(this),
            'poll': this.transformPollField.bind(this),
            'field-group': this.transformFieldGroupField.bind(this)
        };

        const transformer = transformers[fieldType];
        if (transformer) {
            return transformer(value, field);
        }

        // Default: return as-is
        return value;
    }

    transformTextField(value) {
        return String(value).trim();
    }

    transformEmailField(value) {
        return String(value).trim().toLowerCase();
    }

    transformNumberField(value) {
        const num = Number(value);
        return isNaN(num) ? null : num;
    }

    transformTextareaField(value) {
        return String(value).trim();
    }

    transformUrlField(value) {
        const url = String(value).trim();
        // Add protocol if missing
        if (url && !url.match(/^https?:\/\//)) {
            return `https://${url}`;
        }
        return url;
    }

    transformPhoneField(value) {
        // Remove all non-digit characters
        const digits = String(value).replace(/\D/g, '');
        return digits;
    }

    transformDateField(value) {
        console.log({ value })
        // Convert to ISO date string
        try {
            const date = new Date(value);
            if (!isNaN(date.getTime())) {
                return date.toISOString().split('T')[0];
            }
        } catch (error) {
            console.error('Invalid date:', value);
        }
        return null;
    }

    transformTimeField(value) {
        // Format time as HH:MM
        if (typeof value === 'string' && value.match(/^\d{1,2}:\d{2}/)) {
            return value;
        }
        return null;
    }

    transformSelectField(value) {
        // Ensure single value
        if (Array.isArray(value)) {
            return value[0] || null;
        }
        return value;
    }

    transformCheckboxField(value) {
        // Ensure array of values
        if (!Array.isArray(value)) {
            return value ? [value] : [];
        }
        return value;
    }

    transformRadioField(value) {
        // Ensure single value
        if (Array.isArray(value)) {
            return value[0] || null;
        }
        return value;
    }

    transformFileField(value) {
        // File uploads should be handled separately by upload service
        // This just validates the file metadata structure
        if (typeof value === 'object' && value.fileId) {
            return {
                fileId: value.fileId,
                fileName: value.fileName || '',
                fileSize: value.fileSize || 0,
                mimeType: value.mimeType || ''
            };
        }
        return value;
    }

    transformRatingField(value, field) {
        const rating = Number(value);
        const max = field.max || 5;
        const min = field.min || 1;

        if (isNaN(rating)) return null;
        if (rating < min) return min;
        if (rating > max) return max;

        return rating;
    }

    transformSliderField(value, field) {
        const num = Number(value);
        const max = field.max || 100;
        const min = field.min || 0;

        if (isNaN(num)) return min;
        if (num < min) return min;
        if (num > max) return max;

        return num;
    }

    transformTagsField(value) {
        // Convert to array of strings
        if (typeof value === 'string') {
            // Split by comma and trim
            return value.split(',').map(tag => tag.trim()).filter(tag => tag);
        }
        if (Array.isArray(value)) {
            return value.map(tag => String(tag).trim()).filter(tag => tag);
        }
        return [];
    }

    transformSchedulerField(value) {
        // Scheduler should have date/time structure
        if (typeof value === 'object' && value.date) {
            return {
                date: this.transformDateField(value.date),
                time: value.time || null,
                timezone: value.timezone || 'UTC'
            };
        }
        return value;
    }

    transformAddressField(value) {
        // Address should be an object with structured fields
        if (typeof value === 'string') {
            return { full: value };
        }

        if (typeof value === 'object') {
            return {
                street: value.street || '',
                city: value.city || '',
                state: value.state || '',
                zip: value.zip || '',
                country: value.country || '',
                full: value.full || this.constructFullAddress(value)
            };
        }

        return value;
    }

    constructFullAddress(parts) {
        const { street, city, state, zip, country } = parts;
        return [street, city, state, zip, country]
            .filter(part => part)
            .join(', ');
    }

    transformSocialField(value) {
        // Social media links/handles
        if (typeof value === 'object') {
            const transformed = {};
            Object.keys(value).forEach(platform => {
                const handle = value[platform];
                if (handle) {
                    // Remove @ symbol if present
                    transformed[platform] = String(handle).replace(/^@/, '');
                }
            });
            return transformed;
        }
        return value;
    }

    transformSignatureField(value) {
        // Signature is typically a base64 image or SVG
        if (typeof value === 'string' && value.startsWith('data:image')) {
            return value; // Base64 image
        }
        return value;
    }

    transformStatementField(value) {
        // Statement fields are display-only, no transformation needed
        return value || null;
    }

    transformBannerField(value) {
        // Banner fields are display-only, no transformation needed
        return value || null;
    }

    transformPollField(value) {
        // Poll responses should be a selected option
        return value;
    }

    transformFieldGroupField(value) {
        // Field group is afor other fields, typically no direct value
        // If it has nested fields, return the object structure as-is
        if (typeof value === 'object') {
            return value;
        }
        return null;
    }

    /**
     * Transform all fields in a submission
     * @param {Object} submissionData - Raw submission data
     * @param {Array} formFields - Form field definitions
     * @returns {Object} - Transformed submission data
     */
    transformAll(submissionData, formFields) {
        const transformed = {};

        formFields.forEach(field => {
            const fieldId = field._id || field.id;
            const fieldType = field.type || field.input_type;
            const value = submissionData[fieldId];

            if (value !== undefined) {
                transformed[fieldId] = this.transformByType(fieldType, value, field);
            }
        });

        return transformed;
    }

    /**
     * Validate field value based on type and constraints
     * @param {string} fieldType - The type of the field
     * @param {*} value - The value to validate
     * @param {Object} field - The field configuration
     * @returns {Object} - Validation result {valid: boolean, error: string}
     */
    validate(fieldType, value, field = {}) {
        const validators = {
            'email': this.validateEmail.bind(this),
            'url': this.validateUrl.bind(this),
            'phone': this.validatePhone.bind(this),
            'number': this.validateNumber.bind(this)
        };

        const validator = validators[fieldType];
        if (validator) {
            return validator(value, field);
        }

        return { valid: true };
    }

    validateEmail(value) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
            return { valid: false, error: 'Invalid email address' };
        }
        return { valid: true };
    }

    validateUrl(value) {
        try {
            new URL(value.startsWith('http') ? value : `https://${value}`);
            return { valid: true };
        } catch {
            return { valid: false, error: 'Invalid URL' };
        }
    }

    validatePhone(value) {
        const digits = String(value).replace(/\D/g, '');
        if (digits.length < 10) {
            return { valid: false, error: 'Phone number must be at least 10 digits' };
        }
        return { valid: true };
    }

    validateNumber(value, field) {
        const num = Number(value);
        if (isNaN(num)) {
            return { valid: false, error: 'Must be a valid number' };
        }

        if (field.min !== undefined && num < field.min) {
            return { valid: false, error: `Must be at least ${field.min}` };
        }

        if (field.max !== undefined && num > field.max) {
            return { valid: false, error: `Must be at most ${field.max}` };
        }

        return { valid: true };
    }
}

module.exports = new FieldTransformService();
