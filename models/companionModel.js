// models/companionModel.js — Companion (personal OS) data slice.
//
// Every entity is PRIVATE to one user (scoped by `user`) and uses `access` soft-delete,
// mirroring the rest of the codebase. A lightweight typed `links[]` lets any entity
// reference another (task→goal "why", task←capture "derived_from") without a separate
// graph store. See project_companion_personal_os plan / memory.

const mongoose = require('mongoose');

const linkSchema = new mongoose.Schema({
    toType: { type: String, enum: ['note', 'task', 'goal', 'habit', 'journal', 'capture'], required: true },
    toId: { type: mongoose.Schema.Types.ObjectId, required: true },
    relation: { type: String, enum: ['derived_from', 'why', 'reflects_on', 'supports', 'about'], default: 'about' },
}, { _id: false });

// Raw inbox item — the sub-5s capture. The coach triages it into a Note/Task/etc.
const captureSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, maxlength: 10000 },
    source: { type: String, enum: ['text', 'voice'], default: 'text' },
    transcript: { type: String, default: null }, // set when source === 'voice' (Google STT)
    status: { type: String, enum: ['inbox', 'triaged'], default: 'inbox' },
    triagedTo: { type: String, default: null }, // 'task' | 'note' | 'journal' | 'dismissed' | …
    lastSurfacedAt: { type: Date, default: null }, // the "drain": rotates what resurfaces
    access: { type: Boolean, default: true },
}, { timestamps: true });
captureSchema.index({ user: 1, status: 1, createdAt: -1 });

const noteSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, default: '', maxlength: 300 },
    body: { type: String, default: '', maxlength: 50000 },
    tags: { type: [String], default: [] },
    links: { type: [linkSchema], default: [] },
    resurfaceScore: { type: Number, default: 0 }, // the "drain": a nightly job ranks these
    lastSurfacedAt: { type: Date, default: null },
    access: { type: Boolean, default: true },
}, { timestamps: true });
noteSchema.index({ user: 1, createdAt: -1 });
noteSchema.index({ user: 1, resurfaceScore: -1 });

const taskSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, maxlength: 500 },
    status: { type: String, enum: ['todo', 'done'], default: 'todo' },
    due: { type: Date, default: null },
    day: { type: String, default: null }, // 'YYYY-MM-DD' — the day this task is planned for (date spine)
    energy: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    // "why does this task exist" — the link up to a goal (core principle: no orphan tasks).
    goal: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanionGoal', default: null },
    whyText: { type: String, default: null }, // human "why" before a Goal entity exists
    // provenance — the capture/journal/coach turn this was derived from.
    source: {
        kind: { type: String, enum: ['manual', 'capture', 'journal', 'coach'], default: 'manual' },
        refId: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    links: { type: [linkSchema], default: [] },
    completedAt: { type: Date, default: null },
    access: { type: Boolean, default: true },
}, { timestamps: true });
taskSchema.index({ user: 1, status: 1, due: 1 });
taskSchema.index({ user: 1, day: 1, status: 1 });
taskSchema.index({ user: 1, createdAt: -1 });

// One row per user per day — the date spine's anchor. Holds the daily intention and the
// chosen focus task. Unique on (user, date) so "today" is always find-or-create.
const planDaySchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true }, // 'YYYY-MM-DD' (server-local day)
    intention: { type: String, default: '', maxlength: 300 },
    mood: { type: String, enum: ['terrible', 'bad', 'neutral', 'good'], default: null },
    focusTaskId: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanionTask', default: null },
}, { timestamps: true });
planDaySchema.index({ user: 1, date: 1 }, { unique: true });

// A journal entry belongs to a day (the date spine). Reflection metadata (emotions/extracted)
// is added later by the reflection engine; the entry itself is the low-friction ritual.
const journalSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    day: { type: String, default: null }, // 'YYYY-MM-DD'
    body: { type: String, required: true, maxlength: 50000 },
    promptId: { type: String, default: null }, // the prompt shown when writing (kills blank-page paralysis)
    mood: { type: String, enum: ['terrible', 'bad', 'neutral', 'good'], default: null },
    // AI reflection engine output (populated async after save):
    emotions: { type: [String], default: [] },
    themes: { type: [String], default: [] },
    reflection: { type: String, default: '' }, // one gentle insight sentence
    reflectedAt: { type: Date, default: null },
    access: { type: Boolean, default: true },
}, { timestamps: true });
journalSchema.index({ user: 1, day: 1, createdAt: -1 });

// Goals: vision → identity → obstacle (WOOP) → status. Evidence-based aspiration, not
// manifestation — the obstacle field forces obstacle-aware planning.
const goalSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, maxlength: 300 },
    vision: { type: String, default: '', maxlength: 2000 },
    identity: { type: String, default: '', maxlength: 300 },
    obstacle: { type: String, default: '', maxlength: 1000 },
    status: { type: String, enum: ['active', 'done', 'archived'], default: 'active' },
    parentGoal: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanionGoal', default: null },
    access: { type: Boolean, default: true },
}, { timestamps: true });
goalSchema.index({ user: 1, status: 1, createdAt: -1 });

// Habits: forgiving by design — a frequency target + rolling completion, NO punishing
// zeroing streak. `logs` holds the days completed; stats are computed client-side.
const habitSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, maxlength: 300 },
    cadenceType: { type: String, enum: ['daily', 'weekly'], default: 'daily' },
    targetPerWeek: { type: Number, default: 7, min: 1, max: 7 },
    goal: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanionGoal', default: null },
    logs: { type: [String], default: [] }, // 'YYYY-MM-DD' days completed
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    access: { type: Boolean, default: true },
}, { timestamps: true });
habitSchema.index({ user: 1, status: 1, createdAt: -1 });

const CompanionCapture = mongoose.model('CompanionCapture', captureSchema);
const CompanionNote = mongoose.model('CompanionNote', noteSchema);
const CompanionTask = mongoose.model('CompanionTask', taskSchema);
const CompanionPlanDay = mongoose.model('CompanionPlanDay', planDaySchema);
const CompanionJournal = mongoose.model('CompanionJournal', journalSchema);
const CompanionGoal = mongoose.model('CompanionGoal', goalSchema);
const CompanionHabit = mongoose.model('CompanionHabit', habitSchema);

module.exports = {
    CompanionCapture, CompanionNote, CompanionTask, CompanionPlanDay,
    CompanionJournal, CompanionGoal, CompanionHabit,
};
