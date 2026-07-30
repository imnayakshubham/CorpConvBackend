// Capture tools: turning what the person says into a task, note, or mood entry.

module.exports = {
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
};
