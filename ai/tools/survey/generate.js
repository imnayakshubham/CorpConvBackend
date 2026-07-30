// Destructive from-scratch generation.

const { FIELD_TYPES, optionItem } = require('./schema');

module.exports = {
  generate_survey: {
    description: 'DESTRUCTIVE: wipes ALL fields and pages. Use ONLY when the survey has zero fields OR the user explicitly says "start over"/"replace everything"/"from scratch". For any edit of existing content (including bulk rewrites) use update_field / batch_edit_fields.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        pages: {
          type: 'array',
          description: 'Page definitions for multi-step. Length must cover the highest page_index used.',
          items: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
            additionalProperties: false,
          },
        },
        fields: {
          type: 'array',
          minItems: 1,
          maxItems: 30,
          items: {
            type: 'object',
            properties: {
              field_type: { type: 'string', enum: FIELD_TYPES },
              label: { type: 'string' },
              placeholder: { type: 'string' },
              description: { type: 'string' },
              is_required: { type: 'boolean' },
              options: { type: 'array', items: optionItem },
              page_index: { type: 'integer', minimum: 0 },
            },
            required: ['field_type', 'label'],
            additionalProperties: false,
          },
        },
      },
      required: ['title', 'fields'],
      additionalProperties: false,
    },
  },
};
