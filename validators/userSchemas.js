const { z } = require('zod');

const mongoId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

const authUserBody = z.object({
  user_email_id: z.string().email('Invalid email address'),
  actual_user_name: z.string().min(1).max(100).optional(),
  user_phone_number: z.string().max(20).optional(),
  user_job_role: z.string().max(100).optional(),
  user_job_experience: z.number().int().min(0).max(100).optional(),
  user_bio: z.string().max(500).optional(),
  user_location: z.string().max(100).optional(),
  provider: z.string().max(50).optional(),
  providerId: z.string().max(200).optional(),
}).strict();

const updateUserProfileBody = z.object({
  user_job_role: z.string().min(1).max(100),
  user_job_experience: z.number().int().min(0).max(100).optional(),
  user_bio: z.string().max(500).optional(),
  user_location: z.string().max(100).optional(),
  secondary_email_id: z.string().email().optional(),
}).strict();

const fetchUsersBody = z.object({
  type: z.enum(['all_users', 'followers', 'pending_followings', 'followings']),
  _id: mongoId.optional(),
  loggedIn: z.boolean().optional(),
}).strict();

const sendFollowRequestBody = z.object({
  senderId: mongoId,
  receiverId: mongoId,
}).strict();

const acceptRejectFollowBody = z.object({
  userId: mongoId,
  requesterId: mongoId,
}).strict();

const revokeSessionBody = z.object({
  token: z.string().min(1, 'Session token is required'),
}).strict();

const revokeAllSessionsBody = z.object({
  exceptCurrent: z.boolean().optional(),
}).strict();

const updateAvatarConfigBody = z.object({
  _id: mongoId,
  avatar_config: z.object({
    style: z.string().max(50).optional(),
    seed: z.string().max(100).optional(),
    options: z.object({
      scale: z.number().min(0).max(200).optional(),
      radius: z.number().min(0).max(50).optional(),
      rotate: z.number().refine(v => [0, 90, 180, 270].includes(v), 'Must be 0, 90, 180, or 270').optional(),
    }).passthrough().optional(),
  }).passthrough(),
}).strict();

const updateQRConfigBody = z.object({
  _id: mongoId,
  qr_config: z.object({}).passthrough(),
}).strict();

const searchQuery = z.object({
  search: z.string().max(200).optional(),
}).passthrough();

const userIdParam = z.object({
  id: mongoId,
});

module.exports = {
  authUserBody,
  updateUserProfileBody,
  fetchUsersBody,
  sendFollowRequestBody,
  acceptRejectFollowBody,
  revokeSessionBody,
  revokeAllSessionsBody,
  updateAvatarConfigBody,
  updateQRConfigBody,
  searchQuery,
  userIdParam,
};
