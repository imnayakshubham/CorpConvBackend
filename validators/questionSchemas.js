const { z } = require('zod');

const mongoId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

const getQuestionsQuery = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
  cursor: z.string().optional(),
  search: z.string().max(200).optional(),
  sortBy: z.enum(['newest', 'oldest', 'most-answers', 'most-liked']).optional(),
  filter: z.enum(['all', 'my-questions']).optional(),
  userId: mongoId.optional(),
}).strip();

const questionIdParam = z.object({
  id: mongoId,
});

const createQuestionBody = z.object({
  question: z.string().min(1, 'Question text is required').max(500).optional(),
  status: z.enum(['draft', 'open', 'closed']).optional(),
  visibility: z.enum(['public', 'workspace']).optional(),
  openAt: z.string().datetime({ offset: true }).optional().nullable(),
  closeAt: z.string().datetime({ offset: true }).optional().nullable(),
}).strip();

const updateQuestionBody = z.object({
  status: z.enum(['draft', 'open', 'closed']).optional(),
  visibility: z.enum(['public', 'workspace']).optional(),
  openAt: z.string().datetime({ offset: true }).optional().nullable(),
  closeAt: z.string().datetime({ offset: true }).optional().nullable(),
}).strip();

module.exports = {
  getQuestionsQuery,
  questionIdParam,
  createQuestionBody,
  updateQuestionBody,
};
