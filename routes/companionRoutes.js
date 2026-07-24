const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { writeLimiter } = require('../middleware/rateLimiter');
const ctrl = require('../controllers/companionController');
const V = require('../validators/companionSchemas');

const router = express.Router();

// All Companion data is private to the authenticated user: protect → [writeLimiter] → validate → controller.

// Captures
router.route('/captures')
    .post(protect, writeLimiter, validate({ body: V.createCaptureBody }), ctrl.createCapture)
    .get(protect, validate({ query: V.listQuery }), ctrl.listCaptures);
router.route('/captures/:id')
    .patch(protect, writeLimiter, validate({ params: V.idParam, body: V.updateCaptureBody }), ctrl.updateCapture);

// Resurfacing ("the drain") — old captures + "on this day" journal entries worth revisiting.
router.route('/resurface').get(protect, ctrl.getResurface);

// Unified lexical search across notes, journals, tasks, captures.
router.route('/search').get(protect, validate({ query: V.searchQuery }), ctrl.search);

// Tasks
router.route('/tasks')
    .post(protect, writeLimiter, validate({ body: V.createTaskBody }), ctrl.createTask)
    .get(protect, validate({ query: V.listQuery }), ctrl.listTasks);
router.route('/tasks/:id')
    .patch(protect, writeLimiter, validate({ params: V.idParam, body: V.updateTaskBody }), ctrl.updateTask)
    .delete(protect, validate({ params: V.idParam }), ctrl.deleteTask);

// Today (date spine) — intention + focus for the current day.
router.route('/today')
    .get(protect, ctrl.getToday)
    .patch(protect, writeLimiter, validate({ body: V.updateTodayBody }), ctrl.updateToday);

// Journal (date spine) — entries for a day.
router.route('/journal')
    .get(protect, validate({ query: V.listQuery }), ctrl.listJournal)
    .post(protect, writeLimiter, validate({ body: V.createJournalBody }), ctrl.createJournal);
router.route('/journal/:id')
    .patch(protect, writeLimiter, validate({ params: V.idParam, body: V.updateJournalBody }), ctrl.updateJournal)
    .delete(protect, validate({ params: V.idParam }), ctrl.deleteJournal);
router.route('/journal/:id/reflect')
    .post(protect, writeLimiter, validate({ params: V.idParam }), ctrl.reflectJournalEntry);

// Voice capture (Google STT; client falls back to browser STT on 501)
router.route('/transcribe')
    .post(protect, writeLimiter, validate({ body: V.transcribeBody }), ctrl.transcribe);

// Notes
router.route('/notes')
    .post(protect, writeLimiter, validate({ body: V.createNoteBody }), ctrl.createNote)
    .get(protect, ctrl.listNotes);
router.route('/notes/:id')
    .patch(protect, writeLimiter, validate({ params: V.idParam, body: V.updateNoteBody }), ctrl.updateNote)
    .delete(protect, validate({ params: V.idParam }), ctrl.deleteNote);

module.exports = router;
