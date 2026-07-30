// Survey-level and page-level structure tools.

module.exports = {
  update_survey_metadata: {
    description: 'Change ONLY the survey title and/or description. Never touches fields or pages.',
    inputSchema: {
      type: 'object',
      properties: {
        survey_title: { type: 'string' },
        survey_description: { type: 'string' },
      },
      additionalProperties: false,
    },
  },

  add_page: {
    description: 'Append a new empty step to an already-populated multi-step survey. NOT for generating fresh content.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } }, additionalProperties: false },
  },

  update_page: {
    description: 'Rename one existing page. Does not touch other pages.',
    inputSchema: {
      type: 'object',
      properties: {
        page_index: { type: 'integer', minimum: 0 },
        title: { type: 'string' },
      },
      required: ['page_index', 'title'],
      additionalProperties: false,
    },
  },

  delete_page: {
    description: 'Remove a page. Fields on it move to the previous page (or stay on page 0 if it was the first).',
    inputSchema: {
      type: 'object',
      properties: { page_index: { type: 'integer', minimum: 0 } },
      required: ['page_index'],
      additionalProperties: false,
    },
  },

  enable_multistep: {
    description: 'Convert a single-page survey into multi-step by adding an empty 2nd page. Does NOT generate new questions.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },

  set_single_step: {
    description: 'Collapse a multi-step survey into ONE page (merges all questions onto page 0, removes extra steps). The correct tool for "single step form"/"remove the steps" — never loop delete_page.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
};
