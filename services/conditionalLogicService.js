/**
 * Conditional Logic Service
 *
 * Evaluates conditional logic for form fields to determine visibility,
 * requirement status, and other dynamic behaviors.
 *
 * Supports:
 * - Simple conditions
 * - Nested AND/OR groups
 * - Multiple operators
 */

class ConditionalLogicService {
    /**
     * Evaluate a single condition against form data
     * @param {Object} condition - The condition to evaluate
     * @param {Object} formData - Current form data
     * @returns {boolean} - True if condition is met
     */
    evaluateCondition(condition, formData) {
        const { field_id, operator, value } = condition;
        const fieldValue = formData[field_id];

        switch (operator) {
            case 'equals':
                return fieldValue == value;

            case 'not_equals':
                return fieldValue != value;

            case 'contains':
                if (typeof fieldValue === 'string') {
                    return fieldValue.includes(value);
                }
                if (Array.isArray(fieldValue)) {
                    return fieldValue.includes(value);
                }
                return false;

            case 'not_contains':
                if (typeof fieldValue === 'string') {
                    return !fieldValue.includes(value);
                }
                if (Array.isArray(fieldValue)) {
                    return !fieldValue.includes(value);
                }
                return true;

            case 'greater_than':
                return Number(fieldValue) > Number(value);

            case 'less_than':
                return Number(fieldValue) < Number(value);

            case 'greater_than_or_equal':
                return Number(fieldValue) >= Number(value);

            case 'less_than_or_equal':
                return Number(fieldValue) <= Number(value);

            case 'is_empty':
                return !fieldValue || fieldValue === '' ||
                       (Array.isArray(fieldValue) && fieldValue.length === 0);

            case 'is_not_empty':
                return !!fieldValue && fieldValue !== '' &&
                       (!Array.isArray(fieldValue) || fieldValue.length > 0);

            case 'starts_with':
                return typeof fieldValue === 'string' && fieldValue.startsWith(value);

            case 'ends_with':
                return typeof fieldValue === 'string' && fieldValue.endsWith(value);

            default:
                console.warn(`Unknown operator: ${operator}`);
                return false;
        }
    }

    /**
     * Evaluate a condition group (AND/OR logic with optional nesting)
     * @param {Object} group - The condition group
     * @param {Object} formData - Current form data
     * @returns {boolean} - True if group conditions are met
     */
    evaluateConditionGroup(group, formData) {
        // Handle simple condition (backward compatibility)
        if (group.type === 'CONDITION' || (!group.type && group.field_id)) {
            return this.evaluateCondition(group, formData);
        }

        const { type, conditions = [], groups = [] } = group;

        // Evaluate all conditions in this group
        const conditionResults = conditions.map(condition =>
            this.evaluateCondition(condition, formData)
        );

        // Recursively evaluate nested groups
        const groupResults = groups.map(nestedGroup =>
            this.evaluateConditionGroup(nestedGroup, formData)
        );

        // Combine all results
        const allResults = [...conditionResults, ...groupResults];

        if (allResults.length === 0) {
            return true; // Empty group evaluates to true
        }

        // Apply AND or OR logic
        if (type === 'AND') {
            return allResults.every(result => result === true);
        } else if (type === 'OR') {
            return allResults.some(result => result === true);
        }

        // Default to AND logic for backward compatibility
        return allResults.every(result => result === true);
    }

    /**
     * Get list of visible fields based on conditional logic
     * @param {Object} survey - Survey document with logic
     * @param {Object} formData - Current form data
     * @returns {Array} - Array of visible field IDs
     */
    getVisibleFields(survey, formData) {
        const visibleFields = [];
        const { survey_form = [], logic = [] } = survey;

        // Build a map of field IDs to their logic rules
        const fieldLogicMap = {};
        logic.forEach(rule => {
            if (rule.field_id) {
                fieldLogicMap[rule.field_id] = rule;
            }
        });

        // Evaluate each field
        survey_form.forEach(field => {
            const fieldId = field._id || field.id;
            const logicRule = fieldLogicMap[fieldId];

            if (!logicRule) {
                // No logic rule = always visible
                visibleFields.push(fieldId);
                return;
            }

            // Evaluate the logic
            const conditionMet = this.evaluateConditionGroup(logicRule, formData);

            // Determine visibility based on action
            const { action = 'show' } = logicRule;
            if (action === 'show' && conditionMet) {
                visibleFields.push(fieldId);
            } else if (action === 'hide' && !conditionMet) {
                visibleFields.push(fieldId);
            } else if (action !== 'hide' && action !== 'show') {
                // For other actions (require, disable), field is still visible
                visibleFields.push(fieldId);
            }
        });

        return visibleFields;
    }

    /**
     * Get list of required fields based on conditional logic
     * @param {Object} survey - Survey document with logic
     * @param {Object} formData - Current form data
     * @returns {Array} - Array of required field IDs
     */
    getRequiredFields(survey, formData) {
        const requiredFields = [];
        const { survey_form = [], logic = [] } = survey;

        // Build a map of field IDs to their logic rules
        const fieldLogicMap = {};
        logic.forEach(rule => {
            if (rule.field_id) {
                fieldLogicMap[rule.field_id] = rule;
            }
        });

        // Evaluate each field
        survey_form.forEach(field => {
            const fieldId = field._id || field.id;
            const isBaseRequired = field.is_required ||
                                   field.validation?.required ||
                                   field.required;

            const logicRule = fieldLogicMap[fieldId];

            // Start with base requirement
            let isRequired = isBaseRequired;

            // Apply logic if exists
            if (logicRule) {
                const conditionMet = this.evaluateConditionGroup(logicRule, formData);
                const { action } = logicRule;

                if (action === 'require' && conditionMet) {
                    isRequired = true;
                } else if (action === 'disable' && conditionMet) {
                    isRequired = false;
                }
            }

            if (isRequired) {
                requiredFields.push(fieldId);
            }
        });

        return requiredFields;
    }

    /**
     * Get complete field states (visibility, requirement, etc.)
     * @param {Object} survey - Survey document
     * @param {Object} formData - Current form data
     * @returns {Object} - Map of field IDs to their states
     */
    getFieldStates(survey, formData) {
        const visibleFields = this.getVisibleFields(survey, formData);
        const requiredFields = this.getRequiredFields(survey, formData);

        const states = {};
        const { survey_form = [] } = survey;

        survey_form.forEach(field => {
            const fieldId = field._id || field.id;
            states[fieldId] = {
                visible: visibleFields.includes(fieldId),
                required: requiredFields.includes(fieldId),
                enabled: true // Can be extended later
            };
        });

        return states;
    }

    /**
     * Validate form data against conditional logic
     * @param {Object} survey - Survey document
     * @param {Object} formData - Form data to validate
     * @returns {Object} - Validation result with errors
     */
    validateWithLogic(survey, formData) {
        const errors = {};
        const visibleFields = this.getVisibleFields(survey, formData);
        const requiredFields = this.getRequiredFields(survey, formData);

        requiredFields.forEach(fieldId => {
            // Only validate if field is visible
            if (!visibleFields.includes(fieldId)) {
                return;
            }

            const value = formData[fieldId];
            if (!value || value === '' ||
                (Array.isArray(value) && value.length === 0)) {
                errors[fieldId] = 'This field is required';
            }
        });

        return {
            valid: Object.keys(errors).length === 0,
            errors
        };
    }
}

module.exports = new ConditionalLogicService();
