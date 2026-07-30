// Tools that act on an existing task.

module.exports = {
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
};
