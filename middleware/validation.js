const validateMessageRequest = (req, res, next) => {
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
        return res.status(400).json({
            success: false,
            error: 'Message is required and must be a string'
        });
    }

    if (message.length > 4000) {
        return res.status(400).json({
            success: false,
            error: 'Message too long (max 4000 characters)'
        });
    }

    // Validate optional parameters
    if (req.body.temperature !== undefined) {
        const temp = parseFloat(req.body.temperature);
        if (isNaN(temp) || temp < 0 || temp > 2) {
            return res.status(400).json({
                success: false,
                error: 'Temperature must be a number between 0 and 2'
            });
        }
    }

    if (req.body.max_tokens !== undefined) {
        const tokens = parseInt(req.body.max_tokens);
        if (isNaN(tokens) || tokens < 1 || tokens > 2000) {
            return res.status(400).json({
                success: false,
                error: 'max_tokens must be a number between 1 and 2000'
            });
        }
    }

    next();
};

const validateSessionId = (req, res, next) => {
    const { sessionId } = req.params;

    if (!sessionId || typeof sessionId !== 'string') {
        return res.status(400).json({
            success: false,
            error: 'Valid sessionId is required'
        });
    }

    next();
};

module.exports = {
    validateMessageRequest,
    validateSessionId
};
