const { z } = require('zod');

const mongoId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');
const pinField = z.string().length(6).regex(/^\d{6}$/, 'PIN must be exactly 6 digits');

const createPollBody = z.object({
    question: z.string().min(1, 'Question is required').max(300),
    options: z.array(z.string().min(1, 'Option cannot be empty').max(200)).min(2).max(6),
    allow_multiple_choice: z.boolean().optional(),
    visibility: z.enum(['public', 'logged_in', 'workspace']).optional(),
    closeAt: z.string().datetime({ offset: true }).optional().nullable(),
    pin_enabled: z.boolean().optional(),
    pin: pinField.optional(),
}).strip().refine(
    (data) => !data.pin_enabled || !!data.pin,
    { message: 'PIN is required when pin_enabled is true', path: ['pin'] }
);

const castVoteBody = z.object({
    option_ids: z.array(mongoId).min(1).max(6),
    pin: pinField.optional(),
}).strip();

const updatePollSettingsBody = z.object({
    closeAt: z.string().datetime({ offset: true }).optional().nullable(),
    pin_enabled: z.boolean().optional(),
    pin: pinField.optional().nullable(),
    visibility: z.enum(['public', 'logged_in', 'workspace']).optional(),
    status: z.enum(['open', 'closed']).optional(),
}).strip().refine(
    (data) => data.pin_enabled !== true || !!data.pin,
    { message: 'PIN is required when enabling pin protection', path: ['pin'] }
);

const getPollsQuery = z.object({
    limit: z.string().regex(/^\d+$/).optional(),
    cursor: z.string().optional(),
    sortBy: z.enum(['activity', 'newest', 'closing-soon']).optional(),
    filter: z.enum(['all', 'my-polls']).optional(),
    userId: mongoId.optional(),
}).strip();

const pollIdParam = z.object({
    id: mongoId,
});

const pollSlugParam = z.object({
    slug: z.string().min(1).max(200),
});

const verifyPinBody = z.object({ pin: pinField }).strip();

module.exports = {
    createPollBody,
    castVoteBody,
    updatePollSettingsBody,
    verifyPinBody,
    getPollsQuery,
    pollIdParam,
    pollSlugParam,
};
