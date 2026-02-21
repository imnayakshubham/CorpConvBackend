const { z } = require('zod');

const mongoId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

const accessChatBody = z.object({
  userId: mongoId,
}).strict();

const createGroupChatBody = z.object({
  name: z.string().min(1, 'Group name is required').max(100),
  users: z.string().min(1, 'Users are required'),
}).strict();

const renameGroupBody = z.object({
  chatId: mongoId,
  chatName: z.string().min(1, 'Chat name is required').max(100),
}).strict();

const groupMemberBody = z.object({
  chatId: mongoId,
  userId: mongoId,
}).strict();

module.exports = {
  accessChatBody,
  createGroupChatBody,
  renameGroupBody,
  groupMemberBody,
};
