// Intention, goal, and habit tools — the longer-horizon direction.

module.exports = {
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
