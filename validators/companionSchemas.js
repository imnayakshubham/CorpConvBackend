const { z } = require('zod');

const mongoId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

const createCaptureBody = z.object({
    body: z.string().min(1, 'Capture cannot be empty').max(10000),
    source: z.enum(['text', 'voice']).optional(),
    transcript: z.string().max(10000).optional().nullable(),
}).strip();

const updateCaptureBody = z.object({
    status: z.enum(['inbox', 'triaged']).optional(),
    triagedTo: z.string().max(30).optional().nullable(),
}).strip();

const createNoteBody = z.object({
    title: z.string().max(300).optional(),
    body: z.string().max(50000).optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
}).strip();

const updateNoteBody = z.object({
    title: z.string().max(300).optional(),
    body: z.string().max(50000).optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
}).strip();

const createTaskBody = z.object({
    title: z.string().min(1, 'Task needs a title').max(500),
    due: z.string().datetime({ offset: true }).optional().nullable(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    energy: z.enum(['low', 'medium', 'high']).optional(),
    goal: mongoId.optional().nullable(),
    whyText: z.string().max(300).optional().nullable(),
    source: z.object({
        kind: z.enum(['manual', 'capture', 'journal', 'coach']).optional(),
        refId: mongoId.optional().nullable(),
    }).strip().optional(),
}).strip();

const updateTaskBody = z.object({
    title: z.string().min(1).max(500).optional(),
    status: z.enum(['todo', 'done']).optional(),
    due: z.string().datetime({ offset: true }).optional().nullable(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    energy: z.enum(['low', 'medium', 'high']).optional(),
    goal: mongoId.optional().nullable(),
    whyText: z.string().max(300).optional().nullable(),
}).strip();

const moodEnum = z.enum(['terrible', 'bad', 'neutral', 'good']);

const updateTodayBody = z.object({
    intention: z.string().max(300).optional(),
    mood: moodEnum.optional().nullable(),
    focusTaskId: mongoId.optional().nullable(),
}).strip();

const createJournalBody = z.object({
    body: z.string().min(1, 'Write something first').max(50000),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    promptId: z.string().max(300).optional().nullable(),
    mood: moodEnum.optional().nullable(),
}).strip();

const updateJournalBody = z.object({
    body: z.string().min(1).max(50000).optional(),
    mood: moodEnum.optional().nullable(),
}).strip();

const listQuery = z.object({
    status: z.string().optional(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
}).strip();

// Voice capture: base64-encoded audio for server-side Google STT (browser STT is the fallback).
const transcribeBody = z.object({
    audioBase64: z.string().min(1).max(15_000_000),
    mimeType: z.string().max(100).optional(),
    languageCode: z.string().max(20).optional(),
    sampleRateHertz: z.number().int().positive().optional(),
}).strip();

const createGoalBody = z.object({
    title: z.string().min(1, 'Goal needs a title').max(300),
    vision: z.string().max(2000).optional(),
    identity: z.string().max(300).optional(),
    obstacle: z.string().max(1000).optional(),
    parentGoal: mongoId.optional().nullable(),
}).strip();

const updateGoalBody = z.object({
    title: z.string().min(1).max(300).optional(),
    vision: z.string().max(2000).optional(),
    identity: z.string().max(300).optional(),
    obstacle: z.string().max(1000).optional(),
    status: z.enum(['active', 'done', 'archived']).optional(),
}).strip();

const createHabitBody = z.object({
    title: z.string().min(1, 'Habit needs a title').max(300),
    cadenceType: z.enum(['daily', 'weekly']).optional(),
    targetPerWeek: z.number().int().min(1).max(7).optional(),
    goal: mongoId.optional().nullable(),
}).strip();

const updateHabitBody = z.object({
    title: z.string().min(1).max(300).optional(),
    cadenceType: z.enum(['daily', 'weekly']).optional(),
    targetPerWeek: z.number().int().min(1).max(7).optional(),
    goal: mongoId.optional().nullable(),
    status: z.enum(['active', 'archived']).optional(),
}).strip();

const logHabitBody = z.object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strip();

const searchQuery = z.object({
    q: z.string().max(200).optional(),
}).strip();

const idParam = z.object({ id: mongoId });

module.exports = {
    createCaptureBody, updateCaptureBody, createNoteBody, updateNoteBody,
    createTaskBody, updateTaskBody, updateTodayBody, createJournalBody, updateJournalBody,
    createGoalBody, updateGoalBody, createHabitBody, updateHabitBody, logHabitBody,
    listQuery, searchQuery, idParam, transcribeBody,
};
