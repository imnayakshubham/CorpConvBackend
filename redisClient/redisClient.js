const Redis = require("ioredis");
const { isProd } = require("../constants");

const getRedisInstance = () => {
    const redis = new Redis({
        host: process.env.UPSTASH_REDIS_URL,
        port: 6379,
        password: process.env.UPSTASH_REDIS_TOKEN,
        tls: {
            rejectUnauthorized: Boolean(isProd), // optional - for local/dev, set true for production
        },
        maxRetriesPerRequest: null, // Disable retries
        enableReadyCheck: false, // Disable ready check
    });

    return redis;
};


module.exports = getRedisInstance;
