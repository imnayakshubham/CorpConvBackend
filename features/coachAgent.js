// features/coachAgent.js — the COMPANION (personal coach) FeaturePlugin for the generic
// agent harness. Mirrors features/surveyAgent.js: everything coach-specific lives here and
// nothing coach-specific leaks into lib/agent/*.
//
// INVARIANT: mutation tools have NO server `execute`. The server streams tool-input-available;
// the CLIENT applyFn is the executor and the human Apply gate is the only path to real state
// (docs/hush-ai-architecture.md §3). This is exactly how "AI proposes, user approves" is enforced.

// ── system prompt ─────────────────────────────────────────────────────────────────
function fmtList(items, empty) {
    if (!items || !items.length) return `  (${empty})`;
    return items.map((t, i) => `  ${i + 1}. ${t}`).join('\n');
}

function buildSystemPrompt(ctx = {}) {
    const today = Array.isArray(ctx.todayTasks) ? ctx.todayTasks : [];
    const goals = Array.isArray(ctx.activeGoals) ? ctx.activeGoals : [];
    const mood = ctx.recentMood || '(unknown)';
    const journal = (ctx.recentJournal || '').trim();
    const openTasks = today.filter((t) => t && t.status !== 'done').map((t) => t.title || t);

    return `You are Hush AI, a warm, perceptive personal coach inside Hushwork. The person you help is trying to think more clearly, act consistently, and make real progress on their life. You reduce their cognitive load — you never add to it.

## HOW YOU BEHAVE (most important)
- Be brief and human. Take the actions that clearly follow from what they said — one, or SEVERAL together in the same reply when they naturally belong (for example: log their mood AND set an intention AND add a task at once). Don't pad with unrelated extras. If nothing is clearly actionable yet, ask ONE focused question.
- NEVER shame. If they've been away or slipped, welcome them back and continue — never "you missed X days".
- When they express a hard feeling ("I feel exhausted", "I'm overwhelmed"): acknowledge it first, then LIGHTEN the load — suggest rest, protect their energy, and offer to defer low-priority tasks. Do not pile on more work.
- When they describe avoidance ("I've been putting this off"): gently ask why, then propose ONE tiny, concrete next step — the smallest possible action — and offer to add it as a task.
- When they voice an aspiration ("I want to get healthier"): help turn it into direction — identity → a specific goal → a small repeatable habit → this week's ONE action. Name a likely obstacle (be realistic, never magical thinking).
- Every task you propose should connect to a "why" (a goal or reason) when one is known.

## HOW YOU ACT
You change the person's system ONLY through tool calls, and every change is shown to them for approval before it takes effect. Prefer the smallest useful action. You can: log how they're feeling (their mood), add a concrete next task, save a note, mark an existing task done, defer a task to later (to lighten today), break a big task into tiny steps (to unblock avoidance), set today's intention, set a meaningful goal (with its why and likely obstacle), and start a small repeatable habit. Reference existing tasks by their exact title from the state below. Do not invent capabilities or mention tools by name.

## CURRENT STATE
Recent mood/energy: ${mood}
Open tasks today (${openTasks.length}):
${fmtList(openTasks, 'nothing scheduled — a light day')}
Active goals (${goals.length}):
${fmtList(goals.map((g) => (g && g.title) || g), 'no goals set yet')}
${journal ? `\nA journal note they just wrote:\n"""\n${journal.slice(0, 1500)}\n"""\nGently reflect it back: name the feeling or the avoidance you notice in it, then offer ONE tiny next step (and offer to add it as a task). Keep it short and warm; never analyse at length or lecture.` : ''}

Use this state. If they seem overloaded (many open tasks and low energy), help them subtract, not add. Never describe how you work internally or name any tool or technology.`;
}

// ── tools (plain JSON-schema inputSchema; NO execute — client applies via the Apply gate) ──
const tools = {
    add_task: {
        description: 'Propose ONE concrete, small next action. Use when the person agrees to act, or when a tiny next step will unblock avoidance. Keep the title short and doable.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'The action, phrased as a short doable task.' },
                energy: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Rough energy the task needs.' },
                why: { type: 'string', description: 'Optional: the goal or reason this task serves, in a few words.' },
            },
            required: ['title'],
            additionalProperties: false,
        },
    },
    add_note: {
        description: 'Capture a thought, insight, or reflection worth keeping. Use when the person shares something to remember, not an action to do.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Short title for the note.' },
                body: { type: 'string', description: 'The note content.' },
            },
            required: ['body'],
            additionalProperties: false,
        },
    },
    log_mood: {
        description: "Log how the person is feeling today. Use whenever they express their mood or energy (e.g. 'I'm exhausted', 'not in a good place', 'feeling great').",
        inputSchema: {
            type: 'object',
            properties: { mood: { type: 'string', enum: ['terrible', 'bad', 'neutral', 'good'] } },
            required: ['mood'],
            additionalProperties: false,
        },
    },
    complete_task: {
        description: 'Mark an EXISTING task done. Identify it by its exact title from the current state.',
        inputSchema: {
            type: 'object',
            properties: { title: { type: 'string', description: 'The title of the task to complete.' } },
            required: ['title'],
            additionalProperties: false,
        },
    },
    defer_task: {
        description: "Move an existing task to later to protect the person's energy today. Identify it by title.",
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'The title of the task to defer.' },
                until: { type: 'string', description: 'When to move it: "tomorrow", "next_week", or a YYYY-MM-DD date.' },
            },
            required: ['title', 'until'],
            additionalProperties: false,
        },
    },
    break_down_task: {
        description: 'Break a task that feels big into 2-4 tiny, concrete steps. Use to unblock avoidance.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'The task to break down (an existing title, or a new one).' },
                steps: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 5, description: 'The small steps.' },
            },
            required: ['title', 'steps'],
            additionalProperties: false,
        },
    },
    set_intention: {
        description: "Set the person's one-line intention for today.",
        inputSchema: {
            type: 'object',
            properties: { text: { type: 'string', description: "Today's intention, one short line." } },
            required: ['text'],
            additionalProperties: false,
        },
    },
    create_goal: {
        description: 'Turn an aspiration into a concrete goal. Include the vision (why it matters) and, when you can, the likeliest obstacle plus a plan for it (evidence-based, never wishful).',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'The goal, stated plainly.' },
                vision: { type: 'string', description: 'Why this matters to them.' },
                obstacle: { type: 'string', description: 'The likeliest obstacle and the plan for it.' },
            },
            required: ['title'],
            additionalProperties: false,
        },
    },
    create_habit: {
        description: 'Start a small, repeatable habit that supports a goal. Prefer a modest weekly target the person can actually keep.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'The habit, phrased as a small repeatable action.' },
                targetPerWeek: { type: 'integer', minimum: 1, maximum: 7, description: 'Days per week (7 = daily).' },
            },
            required: ['title'],
            additionalProperties: false,
        },
    },
};

function validateContext(ctx) {
    if (ctx != null && typeof ctx !== 'object') return 'coachContext must be an object when provided.';
    return null;
}

const SUMMARY_SYSTEM =
    'You condense a coaching chat into a short recap so the conversation can continue with less history. ' +
    'Write 2-4 plain sentences, third person, covering what the person is working on, how they seem to be feeling, ' +
    'and the key decisions or actions agreed. No preamble, no markdown. Never mention how the assistant works internally.';

/** @type {import('../lib/agent/types').FeaturePlugin} */
module.exports = {
    key: 'companion',
    domainNoun: 'plan',
    contextKey: 'coachContext',
    brandName: 'Hush AI',
    buildSystemPrompt,
    tools,
    validateContext,
    // The coach is a focused edit loop, never the multi-agent build pipeline.
    wantsLargeBuild: () => false,
    extractionSystem:
        'Extract only what matters for coaching: goals, feelings, obstacles, commitments, and next actions. Be concise.',
    summarySystem: SUMMARY_SYSTEM,
};
