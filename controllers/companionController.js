// controllers/companionController.js — CRUD for the Companion data slice.
//
// Every handler is scoped to the authenticated user (req.user._id) — there are NO public
// read paths. Uses the codebase's { status, data, message } response envelope and `access`
// soft-delete. Mirrors the poll controller style.

const { CompanionCapture, CompanionNote, CompanionTask, CompanionPlanDay, CompanionJournal } = require('../models/companionModel');
const { sanitizeRichText } = require('../utils/sanitize');
const { runJournalReflection } = require('../features/journalReflectionRunner');

const fail = (res, code, message) => res.status(code).json({ status: 'Failed', data: null, message });
const ok = (res, data, message = 'Success', code = 200) => res.status(code).json({ status: 'Success', data, message });

// ── Captures ────────────────────────────────────────────────────────────────────
const createCapture = async (req, res) => {
    try {
        const { body, source = 'text', transcript = null } = req.body;
        const capture = await CompanionCapture.create({ user: req.user._id, body, source, transcript });
        return ok(res, capture, 'Captured', 201);
    } catch (e) { console.error('createCapture error:', e); return fail(res, 500, 'Something went wrong'); }
};

const listCaptures = async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 50, 100);
        const query = { user: req.user._id, access: true };
        if (req.query.status) query.status = req.query.status;
        const captures = await CompanionCapture.find(query).sort({ createdAt: -1 }).limit(limit).lean();
        return ok(res, captures);
    } catch (e) { console.error('listCaptures error:', e); return fail(res, 500, 'Something went wrong'); }
};

// ── Tasks ───────────────────────────────────────────────────────────────────────
const createTask = async (req, res) => {
    try {
        const { title, due, day, energy, goal, whyText, source } = req.body;
        const task = await CompanionTask.create({
            user: req.user._id,
            title,
            due: due ? new Date(due) : null,
            day: day || todayStr(), // defaults to today so new tasks land on today's plan
            energy: energy || 'medium',
            goal: goal || null,
            whyText: whyText || null,
            source: source || { kind: 'manual' },
        });
        return ok(res, task, 'Task created', 201);
    } catch (e) { console.error('createTask error:', e); return fail(res, 500, 'Something went wrong'); }
};

const listTasks = async (req, res) => {
    try {
        const query = { user: req.user._id, access: true };
        if (req.query.status) query.status = req.query.status;
        if (req.query.day) query.day = req.query.day;
        const tasks = await CompanionTask.find(query).sort({ createdAt: -1 }).limit(200).lean();
        return ok(res, tasks);
    } catch (e) { console.error('listTasks error:', e); return fail(res, 500, 'Something went wrong'); }
};

const updateTask = async (req, res) => {
    try {
        const updates = { ...req.body };
        if (updates.due) updates.due = new Date(updates.due);
        if (updates.status === 'done') updates.completedAt = new Date();
        if (updates.status === 'todo') updates.completedAt = null;
        const task = await CompanionTask.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id, access: true },
            updates,
            { new: true },
        ).lean();
        if (!task) return fail(res, 404, 'Task not found');
        return ok(res, task, 'Task updated');
    } catch (e) { console.error('updateTask error:', e); return fail(res, 500, 'Something went wrong'); }
};

const deleteTask = async (req, res) => {
    try {
        const task = await CompanionTask.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            { access: false },
            { new: true },
        ).lean();
        if (!task) return fail(res, 404, 'Task not found');
        return ok(res, { _id: task._id }, 'Task deleted');
    } catch (e) { console.error('deleteTask error:', e); return fail(res, 500, 'Something went wrong'); }
};

// ── Notes ───────────────────────────────────────────────────────────────────────
const createNote = async (req, res) => {
    try {
        const { title = '', body = '', tags = [] } = req.body;
        const note = await CompanionNote.create({ user: req.user._id, title, body, tags });
        return ok(res, note, 'Note created', 201);
    } catch (e) { console.error('createNote error:', e); return fail(res, 500, 'Something went wrong'); }
};

const listNotes = async (req, res) => {
    try {
        const notes = await CompanionNote.find({ user: req.user._id, access: true })
            .sort({ createdAt: -1 }).limit(200).lean();
        return ok(res, notes);
    } catch (e) { console.error('listNotes error:', e); return fail(res, 500, 'Something went wrong'); }
};

const updateNote = async (req, res) => {
    try {
        const note = await CompanionNote.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id, access: true },
            { ...req.body },
            { new: true },
        ).lean();
        if (!note) return fail(res, 404, 'Note not found');
        return ok(res, note, 'Note updated');
    } catch (e) { console.error('updateNote error:', e); return fail(res, 500, 'Something went wrong'); }
};

const deleteNote = async (req, res) => {
    try {
        const note = await CompanionNote.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            { access: false },
            { new: true },
        ).lean();
        if (!note) return fail(res, 404, 'Note not found');
        return ok(res, { _id: note._id }, 'Note deleted');
    } catch (e) { console.error('deleteNote error:', e); return fail(res, 500, 'Something went wrong'); }
};

// ── Today (date spine): intention + focus ────────────────────────────────────────
function todayStr() {
    const d = new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
}

const getToday = async (req, res) => {
    try {
        const date = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) ? req.query.date : todayStr();
        let plan = await CompanionPlanDay.findOne({ user: req.user._id, date }).lean();
        if (!plan) plan = (await CompanionPlanDay.create({ user: req.user._id, date })).toObject();
        return ok(res, plan);
    } catch (e) { console.error('getToday error:', e); return fail(res, 500, 'Something went wrong'); }
};

const updateToday = async (req, res) => {
    try {
        const date = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) ? req.query.date : todayStr();
        const updates = {};
        if (typeof req.body.intention === 'string') updates.intention = req.body.intention;
        if ('mood' in req.body) updates.mood = req.body.mood || null;
        if ('focusTaskId' in req.body) updates.focusTaskId = req.body.focusTaskId || null;
        const plan = await CompanionPlanDay.findOneAndUpdate(
            { user: req.user._id, date },
            { $set: updates },
            { new: true, upsert: true, setDefaultsOnInsert: true },
        ).lean();
        return ok(res, plan, 'Updated');
    } catch (e) { console.error('updateToday error:', e); return fail(res, 500, 'Something went wrong'); }
};

// ── Journal ──────────────────────────────────────────────────────────────────────
const createJournal = async (req, res) => {
    try {
        const { body, day, promptId = null, mood = null } = req.body;
        const date = day || todayStr();
        // Journal is rich HTML from the Notion-like editor — allow the safe subset, strip the rest.
        const cleanBody = sanitizeRichText(body);
        const entry = await CompanionJournal.create({ user: req.user._id, body: cleanBody, day: date, promptId, mood });
        runJournalReflection(entry._id, req.user._id, cleanBody); // fire-and-forget AI reflection
        // A journal mood also becomes the day's mood (one primary mood per day).
        if (mood) {
            await CompanionPlanDay.findOneAndUpdate(
                { user: req.user._id, date },
                { $set: { mood } },
                { upsert: true, setDefaultsOnInsert: true },
            );
        }
        return ok(res, entry, 'Saved', 201);
    } catch (e) { console.error('createJournal error:', e); return fail(res, 500, 'Something went wrong'); }
};

const listJournal = async (req, res) => {
    try {
        const query = { user: req.user._id, access: true };
        if (req.query.day) query.day = req.query.day;
        const entries = await CompanionJournal.find(query).sort({ createdAt: -1 }).limit(100).lean();
        return ok(res, entries);
    } catch (e) { console.error('listJournal error:', e); return fail(res, 500, 'Something went wrong'); }
};

const updateJournal = async (req, res) => {
    try {
        const updates = {};
        if (typeof req.body.body === 'string') updates.body = sanitizeRichText(req.body.body);
        if ('mood' in req.body) updates.mood = req.body.mood || null;
        const entry = await CompanionJournal.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id, access: true },
            updates,
            { new: true },
        ).lean();
        if (!entry) return fail(res, 404, 'Entry not found');
        return ok(res, entry, 'Updated');
    } catch (e) { console.error('updateJournal error:', e); return fail(res, 500, 'Something went wrong'); }
};

const deleteJournal = async (req, res) => {
    try {
        const entry = await CompanionJournal.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            { access: false },
            { new: true },
        ).lean();
        if (!entry) return fail(res, 404, 'Entry not found');
        return ok(res, { _id: entry._id }, 'Deleted');
    } catch (e) { console.error('deleteJournal error:', e); return fail(res, 500, 'Something went wrong'); }
};

// On-demand (re)run of the AI reflection for one entry — awaits and returns the updated entry.
const reflectJournalEntry = async (req, res) => {
    try {
        const entry = await CompanionJournal.findOne({ _id: req.params.id, user: req.user._id, access: true }).lean();
        if (!entry) return fail(res, 404, 'Entry not found');
        await runJournalReflection(entry._id, req.user._id, entry.body);
        const updated = await CompanionJournal.findById(entry._id).lean();
        return ok(res, updated, 'Reflected');
    } catch (e) { console.error('reflectJournalEntry error:', e); return fail(res, 500, 'Something went wrong'); }
};

// ── Resurfacing ("the drain") ────────────────────────────────────────────────────
// Nothing captured is forgotten. On visit, surface a few old inbox captures (rotating via
// lastSurfacedAt) plus journal entries from this same calendar day in the past ("on this day").
const getResurface = async (req, res) => {
    try {
        const now = new Date();
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 3600 * 1000);
        const halfDayAgo = new Date(now.getTime() - 12 * 3600 * 1000);

        const captures = await CompanionCapture.find({
            user: req.user._id,
            access: true,
            status: 'inbox',
            createdAt: { $lt: halfDayAgo }, // let a fresh capture breathe before resurfacing it
            $or: [{ lastSurfacedAt: null }, { lastSurfacedAt: { $lt: threeDaysAgo } }],
        }).sort({ createdAt: 1 }).limit(3).lean();

        if (captures.length) {
            await CompanionCapture.updateMany(
                { _id: { $in: captures.map((c) => c._id) } },
                { $set: { lastSurfacedAt: now } },
            );
        }

        const today = todayStr();
        const mmdd = today.slice(5); // 'MM-DD'
        const onThisDay = await CompanionJournal.find({
            user: req.user._id,
            access: true,
            day: { $regex: `-${mmdd}$`, $ne: today },
        }).sort({ day: -1 }).limit(3).lean();

        return ok(res, { captures, onThisDay });
    } catch (e) { console.error('getResurface error:', e); return fail(res, 500, 'Something went wrong'); }
};

const updateCapture = async (req, res) => {
    try {
        const updates = {};
        if (req.body.status) updates.status = req.body.status;
        if ('triagedTo' in req.body) updates.triagedTo = req.body.triagedTo || null;
        const capture = await CompanionCapture.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            updates,
            { new: true },
        ).lean();
        if (!capture) return fail(res, 404, 'Capture not found');
        return ok(res, capture, 'Updated');
    } catch (e) { console.error('updateCapture error:', e); return fail(res, 500, 'Something went wrong'); }
};

// ── Unified search ───────────────────────────────────────────────────────────────
// Lexical, case-insensitive search across notes, journals, tasks, and captures. (Semantic
// vector search is a later addition; this is the plan's "MVP = text search".)
function escapeRegex(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function stripHtmlText(s) {
    return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const search = async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (q.length < 2) return ok(res, []);
        const rx = new RegExp(escapeRegex(q), 'i');
        const uid = req.user._id;
        const [notes, journals, tasks, captures] = await Promise.all([
            CompanionNote.find({ user: uid, access: true, $or: [{ title: rx }, { body: rx }] }).sort({ createdAt: -1 }).limit(15).lean(),
            CompanionJournal.find({ user: uid, access: true, body: rx }).sort({ createdAt: -1 }).limit(15).lean(),
            CompanionTask.find({ user: uid, access: true, title: rx }).sort({ createdAt: -1 }).limit(15).lean(),
            CompanionCapture.find({ user: uid, access: true, body: rx }).sort({ createdAt: -1 }).limit(15).lean(),
        ]);
        const items = [];
        for (const n of notes) items.push({ id: `n_${n._id}`, type: 'note', title: n.title || stripHtmlText(n.body).slice(0, 60), snippet: stripHtmlText(n.body).slice(0, 160), day: null, ts: new Date(n.createdAt).getTime() });
        for (const j of journals) items.push({ id: `j_${j._id}`, type: 'journal', title: 'Journal entry', snippet: stripHtmlText(j.body).slice(0, 160), day: j.day || null, ts: new Date(j.createdAt).getTime() });
        for (const t of tasks) items.push({ id: `t_${t._id}`, type: 'task', title: t.title, snippet: '', day: t.day || null, ts: new Date(t.createdAt).getTime() });
        for (const c of captures) items.push({ id: `c_${c._id}`, type: 'capture', title: stripHtmlText(c.body).slice(0, 60), snippet: '', day: null, ts: new Date(c.createdAt).getTime() });
        items.sort((a, b) => b.ts - a.ts);
        return ok(res, items.slice(0, 40));
    } catch (e) { console.error('search error:', e); return fail(res, 500, 'Something went wrong'); }
};

// ── Voice transcription (Google Cloud Speech-to-Text) ────────────────────────────
// @google-cloud/speech is an OPTIONAL dependency. If it isn't installed or credentials
// (GOOGLE_APPLICATION_CREDENTIALS) aren't configured, the endpoint returns 501 and the
// client falls back to the browser Web Speech API.
let _speechClient = null;
let _speechUnavailable = false;
function getSpeechClient() {
    if (_speechClient || _speechUnavailable) return _speechClient;
    try {
        const speech = require('@google-cloud/speech');
        _speechClient = new speech.SpeechClient(); // reads GOOGLE_APPLICATION_CREDENTIALS
    } catch (e) {
        _speechUnavailable = true;
        console.warn('[companion] Google STT unavailable (using browser fallback):', e.message);
    }
    return _speechClient;
}

const transcribe = async (req, res) => {
    try {
        const client = getSpeechClient();
        if (!client) {
            return res.status(501).json({
                status: 'Failed', data: null,
                message: 'Server speech-to-text is not configured. Use on-device voice input.',
            });
        }
        const { audioBase64, mimeType = 'audio/webm', languageCode = 'en-US', sampleRateHertz } = req.body;
        const encoding = mimeType.includes('webm') ? 'WEBM_OPUS'
            : mimeType.includes('ogg') ? 'OGG_OPUS'
                : mimeType.includes('wav') ? 'LINEAR16'
                    : 'ENCODING_UNSPECIFIED';
        const [response] = await client.recognize({
            audio: { content: audioBase64 },
            config: {
                encoding,
                languageCode,
                enableAutomaticPunctuation: true,
                ...(sampleRateHertz ? { sampleRateHertz } : {}),
            },
        });
        const transcript = (response.results || [])
            .map((r) => r.alternatives?.[0]?.transcript || '')
            .join(' ')
            .trim();
        return ok(res, { transcript });
    } catch (e) {
        console.error('transcribe error:', e);
        return fail(res, 500, 'Transcription failed');
    }
};

module.exports = {
    createCapture, listCaptures,
    createTask, listTasks, updateTask, deleteTask,
    createNote, listNotes, updateNote, deleteNote,
    getToday, updateToday,
    createJournal, listJournal, updateJournal, deleteJournal, reflectJournalEntry,
    getResurface, updateCapture,
    search,
    transcribe,
};
