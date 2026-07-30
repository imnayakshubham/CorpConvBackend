// Question-set tools: generate, update, add, remove.

const { questionSchema } = require('./schema');

module.exports = {
    generate_questions: {
        description: 'Create or completely replace the question set. Use for the first draft or when the creator asks to redo everything. Provide 2 to the max coherent, interrelated questions with the best format each.',
        inputSchema: {
            type: 'object',
            properties: {
                questions: { type: 'array', items: questionSchema(), minItems: 2, maxItems: 20, description: 'The full ordered question list.' },
            },
            required: ['questions'],
            additionalProperties: false,
        },
    },
    update_question: {
        description: 'Update ONE existing question, identified by its 1-based number in the current list. Only include the fields that change.',
        inputSchema: {
            type: 'object',
            properties: {
                index: { type: 'number', description: '1-based position of the question to update.' },
                text: { type: 'string' },
                type: { type: 'string', enum: ['text', 'single_choice', 'rating'] },
                options: { type: 'array', items: { type: 'string' } },
                rating_scale: {
                    type: 'object',
                    properties: { min: { type: 'number' }, max: { type: 'number' }, min_label: { type: 'string' }, max_label: { type: 'string' } },
                    required: ['min', 'max'],
                    additionalProperties: false,
                },
                rationale: { type: 'string' },
                is_required: { type: 'boolean' },
            },
            required: ['index'],
            additionalProperties: false,
        },
    },
    add_question: {
        description: 'Add ONE new, fully-written question to the end of the set (respecting the max). You MUST include the real question "text" (and options for single_choice / a scale for rating) — never add a blank placeholder.',
        inputSchema: questionSchema(),
    },
    remove_question: {
        description: 'Remove ONE question by its 1-based number.',
        inputSchema: {
            type: 'object',
            properties: { index: { type: 'number', description: '1-based position of the question to remove.' } },
            required: ['index'],
            additionalProperties: false,
        },
    },
};
