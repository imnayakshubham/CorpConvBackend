const { z } = require('zod');
const { buildQuestionInput } = require('./shared/questionSchemas');

const mongoId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');
const pinField = z.string().length(6).regex(/^\d{6}$/, 'PIN must be exactly 6 digits');

const criteriaField = z.array(z.string().min(1).max(300)).max(20);

// A single question, as saved by the builder — the shared base (single_choice ⇒ ≥2 options;
// rating ⇒ a valid scale) plus the Litmus-only `rationale`.
const questionInput = buildQuestionInput({ rationale: z.string().max(400).optional() });

const responseSettings = z.object({
    max_responses: z.number().int().min(1).max(100000).nullable().optional(),
    collect_name: z.boolean().optional(),
    closes_at: z.string().datetime({ offset: true }).nullable().optional(),
}).strip();

const createLitmusBody = z.object({
    title: z.string().min(3, 'Title must be at least 3 characters').max(120),
    needs_description: z.string().min(1, 'Describe what you are evaluating for').max(4000),
    evaluation_criteria: criteriaField.optional(),
    max_questions: z.number().int().min(2).max(20).optional(),
}).strip();

const editLitmusBody = z.object({
    title: z.string().min(3).max(120).optional(),
    needs_description: z.string().min(1).max(4000).optional(),
    evaluation_criteria: criteriaField.optional(),
    max_questions: z.number().int().min(2).max(20).optional(),
    questions: z.array(questionInput).min(2, 'A litmus needs at least 2 questions').max(20).optional(),
    status: z.enum(['draft', 'published', 'archived']).optional(),
    pin_enabled: z.boolean().optional(),
    pins: z.array(pinField).max(10).optional(),
    response_settings: responseSettings.optional(),
}).strip().refine(
    (d) => d.pin_enabled !== true || (d.pins && d.pins.length > 0),
    { message: 'At least one access code is required when PIN is enabled', path: ['pins'] }
).refine(
    // Can't publish without questions in the same payload OR relying on existing ones — the
    // controller re-checks against the stored doc; this only blocks an obviously-empty publish.
    (d) => d.status !== 'published' || d.questions === undefined || d.questions.length >= 2,
    { message: 'A litmus needs at least 2 questions to publish', path: ['questions'] }
);

const litmusSubmissionBody = z.object({
    respondent_name: z.string().max(120).optional(),
    pin: pinField.optional(),
    responses: z.array(z.object({
        question_id: mongoId,
        answer: z.union([z.string().max(5000), z.number(), z.null()]),
    }).strip()).min(1, 'No answers submitted').max(20),
}).strip();

const verifyPinBody = z.object({ pin: pinField }).strip();

const listQuery = z.object({
    limit: z.string().regex(/^\d+$/).optional(),
    cursor: z.string().optional(),
}).strip();

const idParam = z.object({ id: mongoId });
const submissionIdParam = z.object({ submissionId: mongoId });
const slugParam = z.object({ slug: z.string().min(1).max(200) });

module.exports = {
    createLitmusBody,
    editLitmusBody,
    litmusSubmissionBody,
    verifyPinBody,
    listQuery,
    idParam,
    submissionIdParam,
    slugParam,
};
