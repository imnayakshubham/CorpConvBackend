// controllers/companionGoalsController.js — Goals + Habits (Phase 3).
//
// User-scoped, access soft-delete, same { status, data, message } envelope as the rest of
// Companion. Habit stats (rolling %, "never miss twice") are computed client-side from `logs`.

const { CompanionGoal, CompanionHabit } = require('../models/companionModel');

const fail = (res, code, message) => res.status(code).json({ status: 'Failed', data: null, message });
const ok = (res, data, message = 'Success', code = 200) => res.status(code).json({ status: 'Success', data, message });

// ── Goals ───────────────────────────────────────────────────────────────────────
const createGoal = async (req, res) => {
    try {
        const { title, vision = '', identity = '', obstacle = '', parentGoal = null } = req.body;
        const goal = await CompanionGoal.create({ user: req.user._id, title, vision, identity, obstacle, parentGoal: parentGoal || null });
        return ok(res, goal, 'Goal created', 201);
    } catch (e) { console.error('createGoal error:', e); return fail(res, 500, 'Something went wrong'); }
};

const listGoals = async (req, res) => {
    try {
        const query = { user: req.user._id, access: true };
        if (req.query.status) query.status = req.query.status;
        const goals = await CompanionGoal.find(query).sort({ createdAt: -1 }).limit(200).lean();
        return ok(res, goals);
    } catch (e) { console.error('listGoals error:', e); return fail(res, 500, 'Something went wrong'); }
};

const updateGoal = async (req, res) => {
    try {
        const goal = await CompanionGoal.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id, access: true },
            { ...req.body },
            { new: true },
        ).lean();
        if (!goal) return fail(res, 404, 'Goal not found');
        return ok(res, goal, 'Updated');
    } catch (e) { console.error('updateGoal error:', e); return fail(res, 500, 'Something went wrong'); }
};

const deleteGoal = async (req, res) => {
    try {
        const goal = await CompanionGoal.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { access: false }, { new: true }).lean();
        if (!goal) return fail(res, 404, 'Goal not found');
        return ok(res, { _id: goal._id }, 'Deleted');
    } catch (e) { console.error('deleteGoal error:', e); return fail(res, 500, 'Something went wrong'); }
};

// ── Habits ──────────────────────────────────────────────────────────────────────
const createHabit = async (req, res) => {
    try {
        const { title, cadenceType = 'daily', targetPerWeek, goal = null } = req.body;
        const habit = await CompanionHabit.create({
            user: req.user._id,
            title,
            cadenceType,
            targetPerWeek: targetPerWeek || (cadenceType === 'daily' ? 7 : 3),
            goal: goal || null,
        });
        return ok(res, habit, 'Habit created', 201);
    } catch (e) { console.error('createHabit error:', e); return fail(res, 500, 'Something went wrong'); }
};

const listHabits = async (req, res) => {
    try {
        const query = { user: req.user._id, access: true, status: req.query.status || 'active' };
        const habits = await CompanionHabit.find(query).sort({ createdAt: -1 }).limit(200).lean();
        return ok(res, habits);
    } catch (e) { console.error('listHabits error:', e); return fail(res, 500, 'Something went wrong'); }
};

const updateHabit = async (req, res) => {
    try {
        const habit = await CompanionHabit.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id, access: true },
            { ...req.body },
            { new: true },
        ).lean();
        if (!habit) return fail(res, 404, 'Habit not found');
        return ok(res, habit, 'Updated');
    } catch (e) { console.error('updateHabit error:', e); return fail(res, 500, 'Something went wrong'); }
};

const deleteHabit = async (req, res) => {
    try {
        const habit = await CompanionHabit.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { access: false }, { new: true }).lean();
        if (!habit) return fail(res, 404, 'Habit not found');
        return ok(res, { _id: habit._id }, 'Deleted');
    } catch (e) { console.error('deleteHabit error:', e); return fail(res, 500, 'Something went wrong'); }
};

// Toggle a habit's completion for one day (forgiving — just add/remove the day).
const logHabit = async (req, res) => {
    try {
        const { day } = req.body;
        const habit = await CompanionHabit.findOne({ _id: req.params.id, user: req.user._id, access: true });
        if (!habit) return fail(res, 404, 'Habit not found');
        const idx = habit.logs.indexOf(day);
        if (idx >= 0) habit.logs.splice(idx, 1);
        else habit.logs.push(day);
        if (habit.logs.length > 400) habit.logs = habit.logs.slice(-400); // bound the array
        await habit.save();
        return ok(res, habit.toObject(), 'Logged');
    } catch (e) { console.error('logHabit error:', e); return fail(res, 500, 'Something went wrong'); }
};

module.exports = {
    createGoal, listGoals, updateGoal, deleteGoal,
    createHabit, listHabits, updateHabit, deleteHabit, logHabit,
};
