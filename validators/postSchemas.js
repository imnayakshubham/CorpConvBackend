const { z } = require('zod');

const mongoId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

const createPostBody = z.object({
  content: z.string().min(1, 'Content is required').max(10000),
  category: z.string().min(1).max(100),
}).strict();

const updatePostBody = z.object({
  _id: mongoId,
  content: z.string().min(1, 'Content is required').max(10000),
  category: z.string().min(1).max(100).optional(),
}).strict();

const upVotePostBody = z.object({
  post_id: mongoId,
}).strict();

const deletePostBody = z.object({
  _id: mongoId,
}).strict();

const fetchPostsQuery = z.object({
  user_id: mongoId.optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  cursor: z.string().optional(),
  include_comments: z.enum(['true', 'false']).optional(),
}).passthrough();

const postIdParam = z.object({
  id: mongoId,
});

module.exports = {
  createPostBody,
  updatePostBody,
  upVotePostBody,
  deletePostBody,
  fetchPostsQuery,
  postIdParam,
};
