// Field-level tools: add, update, delete, duplicate, reorder, move.

const { FIELD_TYPES, optionItem, fieldUpdates } = require('./schema');

module.exports = {
  add_field: {
    description: 'Append ONE new field. Do not add extra related fields the user did not ask for.',
    inputSchema: {
      type: 'object',
      properties: {
        field_type: { type: 'string', enum: FIELD_TYPES },
        label: { type: 'string' },
        placeholder: { type: 'string' },
        description: { type: 'string' },
        is_required: { type: 'boolean' },
        options: { type: 'array', items: optionItem, description: 'Required for radio/checkbox.' },
        page_index: { type: 'integer', minimum: 0 },
      },
      required: ['field_type', 'label'],
      additionalProperties: false,
    },
  },

  update_field: {
    description: 'Update ONE existing field. Include in `updates` ONLY the keys the user asked to change (each overwrites the current value). Prefer this over generate_survey when fields exist.',
    inputSchema: {
      type: 'object',
      properties: {
        field_id: { type: 'string', description: 'Exact _id / temp_id from the field list.' },
        updates: fieldUpdates,
      },
      required: ['field_id', 'updates'],
      additionalProperties: false,
    },
  },

  bulk_update_fields: {
    description: 'Apply the SAME change to multiple fields at once. Use only when the user says "all"/"every" or names a clear subset.',
    inputSchema: {
      type: 'object',
      properties: {
        field_ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
        updates: fieldUpdates,
      },
      required: ['field_ids', 'updates'],
      additionalProperties: false,
    },
  },

  batch_edit_fields: {
    description: 'Apply a DIFFERENT change per field across several fields in ONE call (one entry per field). Use for adaptive set revisions like "reword every question" or "fix the ones that do not fit".',
    inputSchema: {
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              field_id: { type: 'string', description: 'Exact _id / temp_id from the field list.' },
              updates: fieldUpdates,
            },
            required: ['field_id', 'updates'],
            additionalProperties: false,
          },
        },
      },
      required: ['edits'],
      additionalProperties: false,
    },
  },

  add_fields: {
    description: 'Append MANY new fields in ONE call (purely additive, wipes nothing). Use when several questions are asked for at once; add them all here, never "one at a time".',
    inputSchema: {
      type: 'object',
      properties: {
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
              options: { type: 'array', items: optionItem, description: 'Required for radio/checkbox.' },
              page_index: { type: 'integer', minimum: 0 },
            },
            required: ['field_type', 'label'],
            additionalProperties: false,
          },
        },
      },
      required: ['fields'],
      additionalProperties: false,
    },
  },

  clear_all_fields: {
    description: 'Remove EVERY field while keeping title, description and pages. Destructive — confirm first if the survey has fields the user worked on.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },

  delete_field: {
    description: 'Remove ONE field from the survey.',
    inputSchema: {
      type: 'object',
      properties: { field_id: { type: 'string' } },
      required: ['field_id'],
      additionalProperties: false,
    },
  },

  duplicate_field: {
    description: 'Clone an existing field ("add another like X" / "copy question 3").',
    inputSchema: {
      type: 'object',
      properties: {
        field_id: { type: 'string' },
        new_label: { type: 'string', description: 'Optional label for the copy. Defaults to "<original> (copy)".' },
      },
      required: ['field_id'],
      additionalProperties: false,
    },
  },

  reorder_fields: {
    description: 'Reorder fields. Must include EVERY field ID in the desired final order.',
    inputSchema: {
      type: 'object',
      properties: {
        ordered_field_ids: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: 'Complete ordered list of every field ID in the desired order.',
        },
      },
      required: ['ordered_field_ids'],
      additionalProperties: false,
    },
  },

  move_field_to_page: {
    description: 'Move a field to a different page (multi-step surveys only).',
    inputSchema: {
      type: 'object',
      properties: {
        field_id: { type: 'string' },
        page_index: { type: 'integer', minimum: 0 },
      },
      required: ['field_id', 'page_index'],
      additionalProperties: false,
    },
  },
};
