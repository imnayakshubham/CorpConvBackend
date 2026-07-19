// controllers/companionInsightsController.js — Life Timeline + Insights (Phase 4).
//
// Both are READ aggregations over the existing Companion collections (no separate event log
// to keep in sync). Insights are deterministic counts/trends — no AI dependency.

const { CompanionJournal, CompanionTask, CompanionGoal, CompanionPlanDay, CompanionHabit } = require('../models/companionModel');
const engine = require('../lib/agent/engine');
const cache = require('../redisClient/cacheHelper');

const fail = (res, code, message) => res.status(code).json({ status: 'Failed', data: null, message });
const ok = (res, data, message = 'Success', code = 200) => res.status(code).json({ status: 'Success', data, message });

function localDayStr(d) {
    const l = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return l.toISOString().slice(0, 10);
}
function tsOfDay(day) {
    return new Date(`${day}T00:00:00`).getTime();
}
function lastNDays(n) {
    const out = [];
    const base = new Date();
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date(base);
        d.setDate(d.getDate() - i);
        out.push(localDayStr(d));
    }
    return out;
}
function stripHtml(s) {
    return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// A unified, dated feed of meaningful moments: journal entries, completed tasks, achieved
// goals, and logged moods — merged and sorted newest-first.
const getTimeline = async (req, res) => {
    try {
        const uid = req.user._id;
        const limit = Math.min(Number(req.query.limit) || 60, 120);

        const [journals, tasksDone, goalsDone, planDays] = await Promise.all([
            CompanionJournal.find({ user: uid, access: true }).sort({ createdAt: -1 }).limit(60).lean(),
            CompanionTask.find({ user: uid, access: true, status: 'done' }).sort({ completedAt: -1 }).limit(60).lean(),
            CompanionGoal.find({ user: uid, access: true, status: 'done' }).sort({ updatedAt: -1 }).limit(30).lean(),
            CompanionPlanDay.find({ user: uid, mood: { $ne: null } }).sort({ date: -1 }).limit(40).lean(),
        ]);

        const items = [];
        for (const j of journals) {
            items.push({ id: `j_${j._id}`, type: 'journal', ts: j.day ? tsOfDay(j.day) : new Date(j.createdAt).getTime(), date: j.day || localDayStr(new Date(j.createdAt)), title: 'Journal entry', snippet: stripHtml(j.body).slice(0, 140) });
        }
        for (const t of tasksDone) {
            const when = t.completedAt ? new Date(t.completedAt).getTime() : (t.day ? tsOfDay(t.day) : new Date(t.updatedAt).getTime());
            items.push({ id: `t_${t._id}`, type: 'task', ts: when, date: t.day || localDayStr(new Date(when)), title: t.title });
        }
        for (const g of goalsDone) {
            const when = new Date(g.updatedAt).getTime();
            items.push({ id: `g_${g._id}`, type: 'goal', ts: when, date: localDayStr(new Date(when)), title: `Achieved: ${g.title}` });
        }
        for (const p of planDays) {
            items.push({ id: `m_${p._id}`, type: 'mood', ts: tsOfDay(p.date), date: p.date, title: p.mood });
        }

        items.sort((a, b) => b.ts - a.ts);
        return ok(res, items.slice(0, limit));
    } catch (e) { console.error('getTimeline error:', e); return fail(res, 500, 'Something went wrong'); }
};

// Weekly/monthly progress: deterministic counts + trends + a few plain-language observations.
async function computeInsights(uid, period) {
    const days = period === 'month' ? 30 : 7;
    const from = new Date(Date.now() - days * 24 * 3600 * 1000);
    const fromDay = localDayStr(from);
    const rangeDays = lastNDays(days);

    const [tasksCompleted, journals, habits, plans, activeGoals] = await Promise.all([
        CompanionTask.countDocuments({ user: uid, access: true, status: 'done', completedAt: { $gte: from } }),
        CompanionJournal.find({ user: uid, access: true, createdAt: { $gte: from } }, { day: 1 }).lean(),
        CompanionHabit.find({ user: uid, access: true, status: 'active' }).lean(),
        CompanionPlanDay.find({ user: uid, mood: { $ne: null }, date: { $gte: fromDay } }, { mood: 1 }).lean(),
        CompanionGoal.countDocuments({ user: uid, access: true, status: 'active' }),
    ]);

    const journalDays = new Set(journals.map((j) => j.day).filter(Boolean)).size;
    const habitStats = habits
        .map((h) => {
            const logs = new Set(h.logs);
            const completed = rangeDays.filter((d) => logs.has(d)).length;
            const target = Math.max(1, Math.round((h.targetPerWeek / 7) * days));
            return { title: h.title, pct: Math.min(100, Math.round((completed / target) * 100)) };
        })
        .sort((a, b) => b.pct - a.pct);

    const moodCounts = {};
    for (const p of plans) moodCounts[p.mood] = (moodCounts[p.mood] || 0) + 1;

    const observations = [];
    observations.push(`You completed ${tasksCompleted} task${tasksCompleted === 1 ? '' : 's'}.`);
    observations.push(`You journaled on ${journalDays} day${journalDays === 1 ? '' : 's'}.`);
    if (habitStats.length) observations.push(`Strongest habit: ${habitStats[0].title} at ${habitStats[0].pct}%.`);
    const topMood = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0];
    if (topMood) observations.push(`Most days you felt ${topMood[0]}.`);

    return { period, days, tasksCompleted, journalDays, activeGoals, habits: habitStats, moodCounts, observations };
}

const getInsights = async (req, res) => {
    try {
        const period = req.query.period === 'month' ? 'month' : 'week';
        const stats = await computeInsights(req.user._id, period);
        return ok(res, stats);
    } catch (e) { console.error('getInsights error:', e); return fail(res, 500, 'Something went wrong'); }
};

const NARRATIVE_SYSTEM =
    'You are a warm, encouraging personal coach writing a short weekly or monthly reflection for someone, based only on their activity numbers. ' +
    'Write 2-3 warm sentences in second person ("you"), celebrating real progress and gently naming one thing to nurture next — never clinical, never shaming, no lists, no markdown. ' +
    'Ground every claim in the numbers provided; do not invent specifics. Under 80 words. Never mention being an AI or how you work.';

// A warm AI narrative over the same stats. Cached per user/period/day so it costs one AI call
// a day at most; degrades gracefully to no narrative if the AI provider is unavailable.
const getInsightsNarrative = async (req, res) => {
    try {
        const uid = req.user._id;
        const period = req.query.period === 'month' ? 'month' : 'week';
        const key = cache.generateKey('companion', 'insightsnarr', String(uid), period, localDayStr(new Date()));
        const cached = await cache.get(key).catch(() => null);
        if (cached) return ok(res, { narrative: cached });

        const s = await computeInsights(uid, period);
        const prompt = [
            `Period: this ${period}`,
            `Tasks completed: ${s.tasksCompleted}`,
            `Days journaled: ${s.journalDays}`,
            `Active goals: ${s.activeGoals}`,
            `Habits: ${s.habits.map((h) => `${h.title} ${h.pct}%`).join(', ') || 'none yet'}`,
            `Mood counts: ${JSON.stringify(s.moodCounts)}`,
        ].join('\n');
        const result = await engine.complete({ role: 'summary', system: NARRATIVE_SYSTEM, prompt, temperature: 0.5, maxOutputTokens: 200 });
        const narrative = (result.text || '').trim().slice(0, 600);
        if (narrative) await cache.set(key, narrative, 60 * 60 * 6).catch(() => {});
        return ok(res, { narrative });
    } catch (e) { console.error('getInsightsNarrative error:', e); return fail(res, 500, 'Something went wrong'); }
};

module.exports = { getTimeline, getInsights, getInsightsNarrative };
