// Non-mutating follow-up suggestions.

module.exports = {
    suggest_followups: {
        description: 'Offer 2–3 short next things the creator might ask you to do. Non-mutating.',
        inputSchema: {
            type: 'object',
            properties: { suggestions: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 } },
            required: ['suggestions'],
            additionalProperties: false,
        },
    },
};
