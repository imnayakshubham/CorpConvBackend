const { z } = require('zod');

const mongoId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

const sendMessageBody = z.object({
  content: z.string().min(1, 'Message content is required').max(5000),
  chatId: mongoId,
  replyTo: mongoId.optional().nullable(),
});

const chatIdParam = z.object({
  chatId: mongoId,
});

const messageIdParam = z.object({
  id: mongoId,
});

const editMessageBody = z.object({
  content: z.string().min(1).max(5000),
});

const reactionBody = z.object({
  emoji: z.string().min(1).max(8),
});

const deliveredBody = z.object({
  chatId: mongoId,
});

module.exports = {
  sendMessageBody,
  chatIdParam,
  messageIdParam,
  editMessageBody,
  reactionBody,
  deliveredBody,
};
