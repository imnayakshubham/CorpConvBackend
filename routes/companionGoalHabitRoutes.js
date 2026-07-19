const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { writeLimiter } = require('../middleware/rateLimiter');
const ctrl = require('../controllers/companionGoalsController');
const V = require('../validators/companionSchemas');

const router = express.Router();

// Goals (per-user private): protect → [writeLimiter] → validate → controller.
router.route('/goals')
    .get(protect, validate({ query: V.listQuery }), ctrl.listGoals)
    .post(protect, writeLimiter, validate({ body: V.createGoalBody }), ctrl.createGoal);
router.route('/goals/:id')
    .patch(protect, writeLimiter, validate({ params: V.idParam, body: V.updateGoalBody }), ctrl.updateGoal)
    .delete(protect, validate({ params: V.idParam }), ctrl.deleteGoal);

// Habits
router.route('/habits')
    .get(protect, validate({ query: V.listQuery }), ctrl.listHabits)
    .post(protect, writeLimiter, validate({ body: V.createHabitBody }), ctrl.createHabit);
router.route('/habits/:id')
    .patch(protect, writeLimiter, validate({ params: V.idParam, body: V.updateHabitBody }), ctrl.updateHabit)
    .delete(protect, validate({ params: V.idParam }), ctrl.deleteHabit);
router.route('/habits/:id/log')
    .post(protect, writeLimiter, validate({ params: V.idParam, body: V.logHabitBody }), ctrl.logHabit);

module.exports = router;
