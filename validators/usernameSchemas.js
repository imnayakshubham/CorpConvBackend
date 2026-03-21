const { z } = require('zod');

const setUsernameBody = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(30, 'Username cannot exceed 30 characters'),
}).strict();

// passthrough so other query params (e.g. pagination) are not stripped
const checkUsernameQuery = z.object({
  username: z.string().min(1, 'username parameter is required').max(50),
}).passthrough();

module.exports = { setUsernameBody, checkUsernameQuery };
