const { z } = require('zod');
const { QUESTION_TYPES } = require('../../shared/questionTypes');

// Shared Zod building blocks for validating a question, reused across features. The base shape and
// the cross-type invariants (single_choice needs options, rating needs a scale) live here once.

const ratingScale = z.object({
    min: z.number().int().min(0).max(10),
    max: z.number().int().min(1).max(10),
    min_label: z.string().max(60).optional(),
    max_label: z.string().max(60).optional(),
}).strip().refine((s) => s.max > s.min, { message: 'rating max must be greater than min' });

// Build a question validator from the shared base plus any feature-specific fields (`extend`).
// The base covers text/type/options/rating_scale/is_required/order; `extend` adds e.g. Litmus's
// `rationale`. The single_choice/rating invariants are enforced for every feature.
function buildQuestionInput(extend = {}) {
    return z.object({
        text: z.string().min(1, 'Question text is required').max(500),
        type: z.enum(QUESTION_TYPES),
        options: z.array(z.string().min(1).max(200)).max(10).optional(),
        rating_scale: ratingScale.optional(),
        is_required: z.boolean().optional(),
        order: z.number().int().optional(),
        ...extend,
    }).strip().superRefine((q, ctx) => {
        if (q.type === 'single_choice' && (!q.options || q.options.length < 2)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'single_choice needs at least 2 options' });
        }
        if (q.type === 'rating' && !q.rating_scale) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rating_scale'], message: 'rating needs a rating_scale' });
        }
    });
}

module.exports = { ratingScale, buildQuestionInput, QUESTION_TYPES };
