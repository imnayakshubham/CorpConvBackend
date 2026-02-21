const { z } = require('zod');

const mongoId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

const createSurveyBody = z.object({
  survey_title: z.string().min(3, 'Title must be at least 3 characters').max(100),
  survey_description: z.string().max(2000).default(''),
}).strict();

const editSurveyBody = z.object({
  survey_title: z.string().min(3).max(100).optional(),
  survey_description: z.string().max(2000).optional(),
  survey_form: z.array(z.object({}).passthrough()).optional(),
  pages: z.array(z.object({}).passthrough()).optional(),
  is_multi_step: z.boolean().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  quiz_settings: z.object({}).passthrough().optional(),
  sharing: z.object({}).passthrough().optional(),
  response_settings: z.object({}).passthrough().optional(),
  theme: z.object({}).passthrough().optional(),
  notifications: z.object({}).passthrough().optional(),
  form_settings: z.object({}).passthrough().optional(),
  slug: z.string().max(100).optional(),
}).strict();

const surveySubmissionBody = z.object({
  responses: z.array(z.object({
    field_id: z.string(),
    value: z.any(),
  }).passthrough()).optional(),
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
}).passthrough();

const surveyIdParam = z.object({
  id: mongoId,
});

module.exports = {
  createSurveyBody,
  editSurveyBody,
  surveySubmissionBody,
  listSurveysQuery,
  surveyIdParam,
};
