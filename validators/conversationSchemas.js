const { z } = require('zod');

const mongoId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

const createRoomBody = z.object({
  name: z.string().min(1, 'Channel name is required').max(80),
  description: z.string().max(300).optional(),
  roomType: z.enum(['public', 'private', 'workspace_townhall']).default('public'),
  visibility: z.enum(['public', 'logged_in', 'workspace']).optional(),
  pin_enabled: z.boolean().optional(),
  pins: z.array(z.string().min(1).max(64)).optional(),
});

const joinRoomBody = z.object({
  pin: z.string().max(64).optional(),
});

const roomIdParam = z.object({
  id: mongoId,
});

const inviteBody = z.object({
  userId: mongoId,
});

const updateRoomBody = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(300).optional(),
  archived: z.boolean().optional(),
});

module.exports = { createRoomBody, joinRoomBody, roomIdParam, inviteBody, updateRoomBody };
