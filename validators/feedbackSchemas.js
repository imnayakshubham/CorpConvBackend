const { z } = require('zod');

const createFeedbackBody = z.object({
  type: z.enum(['bug', 'feature', 'other']),
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().min(1, 'Description is required').max(5000),
}).strict();

module.exports = {
  createFeedbackBody,
};
