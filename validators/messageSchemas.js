const { z } = require('zod');

const mongoId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

const sendMessageBody = z.object({
  content: z.string().min(1, 'Message content is required').max(5000),
  chatId: mongoId,
}).strict();

const chatIdParam = z.object({
  chatId: mongoId,
});

module.exports = {
  sendMessageBody,
  chatIdParam,
};
