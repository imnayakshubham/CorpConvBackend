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
  title: z.string().min(1, 'Question title is required').max(500),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
}).strict();

module.exports = {
  getQuestionsQuery,
  questionIdParam,
  createQuestionBody,
};
