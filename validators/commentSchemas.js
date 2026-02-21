const { z } = require('zod');

const mongoId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

const postCommentBody = z.object({
  comment: z.string().min(1, 'Comment is required').max(5000),
  post_id: mongoId,
  parent_comment_id: mongoId.optional(),
  comment_id: mongoId.optional(),
}).strict();

const postReplyBody = z.object({
  comment: z.string().min(1, 'Comment is required').max(5000),
  post_id: mongoId,
  parent_comment_id: mongoId,
}).strict();

const likeCommentBody = z.object({
  comment_id: mongoId,
  parent_comment_id: mongoId.optional(),
  post_id: mongoId,
}).strict();

const deleteCommentBody = z.object({
  comment_id: mongoId,
  post_id: mongoId.optional(),
}).strict();

const updateCommentBody = z.object({
  comment: z.string().min(1, 'Comment is required').max(5000),
}).strict();

const postIdParam = z.object({
  post_id: mongoId,
});

const commentIdParam = z.object({
  comment_id: mongoId,
});

const paginationQuery = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
  cursor: mongoId.optional(),
}).passthrough();

module.exports = {
  postCommentBody,
  postReplyBody,
  likeCommentBody,
  deleteCommentBody,
  updateCommentBody,
  postIdParam,
  commentIdParam,
  paginationQuery,
};
