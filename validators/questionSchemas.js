const { z } = require('zod');

const mongoId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

const getQuestionsQuery = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
  cursor: z.string().optional(),
  search: z.string().max(200).optional(),
  sortBy: z.enum(['newest', 'oldest', 'most-answers', 'most-liked']).optional(),
  filter: z.enum(['all', 'my-questions']).optional(),
  userId: mongoId.optional(),
}).passthrough();

const questionIdParam = z.object({
  id: mongoId,
});

module.exports = {
  getQuestionsQuery,
  questionIdParam,
};
