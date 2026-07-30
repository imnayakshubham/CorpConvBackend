// The question schema for the litmus tools.
//
// Factory (not a shared const) so every tool gets its OWN schema object — a shared reference
// across two tools can be $ref-collapsed by the schema converter and confuse the model.
function questionSchema() {
    return {
        type: 'object',
        properties: {
            text: { type: 'string', description: 'REQUIRED. The complete, final question text shown to the respondent — write the real wording, never blank or a placeholder. Self-contained; never contains the criteria.' },
            type: { type: 'string', enum: ['text', 'single_choice', 'rating'], description: 'Best format for this question.' },
            options: { type: 'array', items: { type: 'string' }, description: 'For single_choice: 2-5 concrete, real answer options (never "Option 1"/"Option 2").' },
            rating_scale: {
                type: 'object',
                properties: {
                    min: { type: 'number' },
                    max: { type: 'number' },
                    min_label: { type: 'string' },
                    max_label: { type: 'string' },
                },
                required: ['min', 'max'],
                additionalProperties: false,
                description: 'For rating: numeric scale with short end labels.',
            },
            rationale: { type: 'string', description: 'One line: how this question ties to the needs/criteria. Creator-only.' },
            is_required: { type: 'boolean', description: 'Whether an answer is required. Default true.' },
        },
        required: ['text', 'type'],
        additionalProperties: false,
    };
}

module.exports = { questionSchema };
