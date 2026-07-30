// Tap-able follow-up options. Does not modify the survey.

module.exports = {
  suggest_followups: {
    description:
      'Offer 2–4 short tap-able options the user can pick with one tap. Adapt them to the moment: (a) when you ask a clarifying question, these are the likely ANSWERS (e.g. tone → "Professional", "Friendly", "Playful"; length → "Short", "Medium", "Detailed"); (b) after a change, they can be next steps. Always pair with a question or a brief lead-in in your text. Does not modify the survey.',
    inputSchema: {
      type: 'object',
      properties: {
        suggestions: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: { type: 'string', description: 'Short tap-able option — an answer to your question or a next action, ≤ 6 words.' },
        },
      },
      required: ['suggestions'],
      additionalProperties: false,
    },
  },
};
