// Title, needs description, and evaluation criteria.

module.exports = {
    set_details: {
        description: 'Refine the litmus title, the needs description, or the evaluation criteria.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                needs_description: { type: 'string' },
                evaluation_criteria: { type: 'array', items: { type: 'string' }, description: 'The full replacement list of criteria.' },
            },
            additionalProperties: false,
        },
    },
};
