const { z } = require('zod');

const mongoId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

const createSurveyBody = z.object({
  survey_title: z.string().min(3, 'Title must be at least 3 characters').max(100),
  survey_description: z.string().max(2000).default(''),
}).strict();

const editSurveyBody = z.object({
  survey_title: z.string().min(3).max(100).optional(),
  survey_description: z.string().max(2000).optional(),
  // z.record(z.unknown()) is functionally equivalent to z.object({}).passthrough()
  // but removes the explicit passthrough() opt-in that bypasses Zod's prototype handling.
  survey_form: z.array(z.record(z.unknown())).optional(),
  pages: z.array(z.record(z.unknown())).optional(),
  is_multi_step: z.boolean().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  quiz_settings: z.record(z.unknown()).optional(),
  sharing: z.record(z.unknown()).optional(),
  response_settings: z.record(z.unknown()).optional(),
  theme: z.record(z.unknown()).optional(),
  notifications: z.record(z.unknown()).optional(),
  form_settings: z.record(z.unknown()).optional(),
  slug: z.string().max(100).optional(),
}).strict();

const surveySubmissionBody = z.object({
  responses: z.array(z.object({
    field_id: z.string(),
    value: z.any(),
  }).strip()).optional(),
  submissions: z.any().optional(),
  is_partial: z.boolean().optional(),
  current_page: z.number().int().min(0).optional(),
  turnstile_token: z.string().optional(),
}).strict();

const listSurveysQuery = z.object({
  view: z.enum(['all', 'my']).optional(),
  search: z.string().max(200).optional(),
  status: z.string().max(50).optional(),
  tags: z.string().max(500).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  createdBy: mongoId.optional(),
  sortBy: z.enum(['newest', 'oldest', 'mostResponses', 'alphabetical']).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  cursor: z.string().optional(),
}).strip();

const surveyIdParam = z.object({
  id: mongoId,
});

// No query params expected; unknown keys are silently stripped.
const tagsQuery = z.object({}).strip();

module.exports = {
  createSurveyBody,
  editSurveyBody,
  surveySubmissionBody,
  listSurveysQuery,
  surveyIdParam,
  tagsQuery,
};
