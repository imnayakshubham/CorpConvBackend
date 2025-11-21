const logger = require('../utils/logger');

class RateLimitHandler {
    constructor() {
        this.modelFailures = new Map(); // Track failures per model
    }

    isRateLimitError(error) {
        return error.status === 429 ||
            error.code === 'rate_limit_exceeded' ||
            error.message?.toLowerCase().includes('rate limit') ||
            error.message?.toLowerCase().includes('too many requests');
    }

    recordFailure(modelName) {
        const failures = this.modelFailures.get(modelName) || 0;
        this.modelFailures.set(modelName, failures + 1);
        logger.warn(`Rate limit failure recorded for ${modelName}. Total: ${failures + 1}`);
    }

    shouldSkipModel(modelName) {
        const failures = this.modelFailures.get(modelName) || 0;
        return failures >= 3; // Skip model after 3 consecutive failures
    }

    resetFailures(modelName) {
        this.modelFailures.delete(modelName);
    }
}

module.exports = new RateLimitHandler();
