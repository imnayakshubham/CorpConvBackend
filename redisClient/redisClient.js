const Redis = require("ioredis");


const getRedisInstance = () => {
    const redis = new Redis(`rediss://default:${process.env.UPSTASH_REDIS_TOKEN}@${process.env.UPSTASH_REDIS_URL}:6379`);
    return redis
}

module.exports = getRedisInstance;