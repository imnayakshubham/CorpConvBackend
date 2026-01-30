const Redis = require("ioredis");

const getRedisInstance = () => {
    try {
        let redis;
        if (process.env.APP_ENV === "DEV") {
            console.log("Initializing Local Redis connection...");
            redis = new Redis({
                host: process.env.REDIS_HOST || "127.0.0.1",
                port: process.env.REDIS_PORT || 6379,
                password: process.env.REDIS_PASSWORD || undefined,
                retryStrategy(times) {
                    const delay = Math.min(times * 50, 2000);
                    return delay;
                },
                maxRetriesPerRequest: null
            });
        } else if (process.env.UPSTASH_REDIS_URL && process.env.UPSTASH_REDIS_TOKEN) {
            console.log("Initializing Upstash Redis connection...");
            redis = new Redis(`rediss://default:${process.env.UPSTASH_REDIS_TOKEN}@${process.env.UPSTASH_REDIS_URL}:6379`, {
                retryStrategy(times) {
                    const delay = Math.min(times * 50, 2000);
                    return delay;
                },
                maxRetriesPerRequest: null
            });
        } else {
            console.warn("Redis environment variables missing. Redis might not be available.");
            return null;
        }

        // Handle errors to prevent crashing the whole app
        redis.on("error", (err) => {
            console.error("Redis error:", err.message);
        });

        redis.on("connect", () => {
            console.log("Redis connected successfully.");
        });

        return redis;
    } catch (error) {
        console.error("Critical error while initializing Redis:", error.message);
        return null;
    }
}

module.exports = getRedisInstance;