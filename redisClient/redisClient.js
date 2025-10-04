const Redis = require("ioredis");
const { isProd } = require("../constants");

const port = 6379
const uri = `rediss://default:${process.env.UPSTASH_REDIS_REST_TOKEN}@${process.env.UPSTASH_REDIS_REST_URL}:${port}?family=6`;

const getRedisInstance = () => {
    const redis = new Redis(uri, {
        tls: {
            rejectUnauthorized: Boolean(isProd), // optional - for local/dev, set true for production
        },
        family: 6,
        maxRetriesPerRequest: null, // Disable retries
        enableReadyCheck: false, // Disable ready check
    });

    redis.on('error', (err) => {
        console.error('Redis error', err);
        throw err
    });
    return redis;
};


module.exports = getRedisInstance;
